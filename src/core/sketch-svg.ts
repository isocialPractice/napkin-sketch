/**
 * A sketch as SVG, with no DOM: the writer behind `Surface.toSVG`, here so
 * code that runs in plain Node - the script language, its outputs, the CLI -
 * writes the same document the app exports.
 */

import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_NIB_ANGLE,
  dashPatternFor,
  defaultOpacityFor,
  isImageStroke,
  isTextStroke,
  normalizedStops,
  strokesByLayer,
  type Layer,
  type Sketch,
  type Stroke,
} from './types.js';
import { copicNibPolygons } from './nib.js';
import { effectReach, filterRegion, readEffects, svgFilterMarkup, type Effect } from './effects.js';
import { linkName } from './link.js';
import { activeProfile, profileInputOf, profileOutline } from './stroke-profile.js';
import { simplify } from '../sharpen/geometry.js';
import { wrapText } from './graphic-design/font.js';
import { strokeBounds } from './bounds.js';
import { clipIndex } from './clip.js';
import { GRAIN_TEXELS_PER_PX, GRAIN_TILE_SIZE, grainTilePng, meanPressure, pencilCoverage, pencilPaint, pencilPicture, pencilRegion, pngDataUrl } from './pencil.js';
import { encodePng } from './graphic-design/png.js';
import { EXPORT_SIMPLIFY_EPSILON, PathData, pathD } from './svg-path.js';

/** How much of the page {@link Surface.toSVG} writes, and on what. */
export interface SvgExportOptions {
  /**
   * Size the document to this box (in sketch coordinates) instead of to the
   * page, so the file holds the graphic and no empty margin around it. The
   * viewBox is offset to the box rather than the geometry being moved, which
   * keeps every coordinate identical to a full-page export.
   */
  crop?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Leave the background rect out, so the document is transparent. */
  transparent?: boolean;
}

/** Rounds to two decimals, so bounds-derived sizes stay readable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Serialises a sketch to an SVG string (lossless vector).
 *
 * Each visible layer becomes a `<g>` group carrying its name and opacity,
 * and layer groups become nested `<g>` elements holding their children, so
 * the exported markup mirrors the layer tree instead of flattening it -
 * an imported document's group hierarchy survives the round trip. Eraser
 * strokes become a black-on-white `<mask>` on their layer's group so they
 * cut holes only in that layer. Marks carry `data-tool` and `data-i`
 * (original paint order) so importing the file restores the layer stack.
 *
 * A layer's name is written three ways so it survives the trip into other
 * editors: `data-name` (napkin's own), `inkscape:label` plus
 * `inkscape:groupmode="layer"` (what Inkscape's layers panel reads), and
 * the group `id` (what Illustrator reads).
 *
 * A mark or a layer with effects references a `<filter>` - the CSS filter
 * functions spelled as SVG filter primitives, see `core/effects.ts` - and
 * carries the list itself as `data-effects`, so the importer restores it.
 * A layer's filter and its eraser mask sit on the same group, where SVG
 * filters first and masks after.
 *
 * {@link SvgExportOptions} trims the document down for use as a sprite:
 * `crop` sizes it to a box instead of the page, and `transparent` leaves
 * the background rect out. Called without options the output is the full
 * page on its paper color.
 */
export function sketchToSvg(sketch: Sketch, options: SvgExportOptions = {}): string {
  const { background } = sketch;
  // The document window: the page by default, or the crop box, which is
  // reached by offsetting the viewBox rather than moving the geometry -
  // the marks keep the coordinates every other export writes.
  const crop = options.crop;
  const viewX = crop ? round2(crop.minX) : 0;
  const viewY = crop ? round2(crop.minY) : 0;
  const width = crop ? Math.max(round2(crop.maxX - crop.minX), 1) : sketch.width;
  const height = crop ? Math.max(round2(crop.maxY - crop.minY), 1) : sketch.height;
  const defs: string[] = [];
  const usedIds = new Set<string>();
  const layerIndex = new Map(sketch.layers.map((layer, i) => [layer.id, i]));
  // Paint order and the per-layer stroke lists are both read once here
  // rather than searched for per mark: `indexOf` inside the mark loop made
  // an export cost the square of the page's size, and so did resolving
  // each layer's strokes by rescanning the page.
  const paintOrder = new Map(sketch.strokes.map((stroke, i) => [stroke.id, i]));
  const orderOf = (stroke: Stroke): number => paintOrder.get(stroke.id) ?? 0;
  const byLayer = strokesByLayer(sketch);
  const defaults = paintDefaults(sketch);
  // Clip groups: each clips with a mark that paints nothing while it does.
  const clips = clipIndex(sketch);

  // The Pencil's grain: the paper's tooth carried once, as a PNG, and one
  // paint for each tone, pencil and pressure the page draws with - the tile
  // put through the coverage rule by a filter's table, tiled as a pattern.
  const pencilPaints = new Map<string, string>();
  const pencilFill = (stroke: Stroke): string => {
    const paint = pencilPaint(stroke.pencil);
    const pressure = Math.round(meanPressure(stroke.points) * 20) / 20;
    const key = `${stroke.color}|${paint.name}|${pressure}`;
    let id = pencilPaints.get(key);
    if (!id) {
      if (pencilPaints.size === 0) {
        const side = fmt(GRAIN_TILE_SIZE / GRAIN_TEXELS_PER_PX);
        defs.push(`<image id="pencil-tooth" width="${side}" height="${side}" preserveAspectRatio="none" href="${pngDataUrl(grainTilePng())}"/>`);
      }
      id = `pencil-${pencilPaints.size + 1}`;
      pencilPaints.set(key, id);
      defs.push(svgPencilPaint(id, stroke.color, paint, pressure));
    }
    return `url(#${id})`;
  };

  // One filter for each effect list over each region, shared when two ask for the same one.
  const filterIds = new Map<string, string>();
  const effectAttrs = (effects: Effect[], box: Edges | null): string => {
    let filter = '';
    if (box) {
      const region = filterRegion(box, effects);
      const key = JSON.stringify([effects, [region.x, region.y, region.width, region.height].map(fmt)]);
      let id = filterIds.get(key);
      if (!id) {
        id = `effect-${filterIds.size + 1}`;
        filterIds.set(key, id);
        defs.push(svgFilterMarkup(effects, id, region, fmt));
      }
      filter = `filter="url(#${id})" `;
    }
    return `${filter}data-effects="${escXml(JSON.stringify(effects))}"`;
  };

  // A rect covering the whole document window, wherever the viewBox sits.
  // The eraser mask needs that cover as much as the paper does: a mask rect
  // left at the origin while the viewBox is offset would fall outside the
  // crop and black out the layer it was meant to keep whole.
  const coverAt = crop ? `x="${viewX}" y="${viewY}" ` : '';
  const coverRect = (fill: string): string =>
    `<rect ${coverAt}width="${width}" height="${height}" fill="${fill}"/>`;

  // Rebuild the tree from the flat stack: a layer belongs under its parent
  // when that parent exists and is a group; anything else (no parent, or a
  // dangling id) exports at the top level. Sibling order follows the stack,
  // and since the store keeps a group's children adjacent to their group
  // row, tree order is paint order.
  const byId = new Map(sketch.layers.map((layer) => [layer.id, layer]));
  const childrenOf = new Map<string, Layer[]>();
  const topLevel: Layer[] = [];
  for (const layer of sketch.layers) {
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (parent?.group) {
      const siblings = childrenOf.get(parent.id) ?? [];
      siblings.push(layer);
      childrenOf.set(parent.id, siblings);
    } else {
      topLevel.push(layer);
    }
  }

  const layerBox = (layer: Layer): Edges | null => {
    if (!layer.visible) return null;
    let box: Edges | null = null;
    const add = (inner: Edges | null, effects: Effect[] | undefined): void => {
      if (!inner) return;
      const reached = effects ? grown(inner, effectReach(effects)) : inner;
      box = box ? joined(box, reached) : reached;
    };
    if (layer.group) {
      for (const child of childrenOf.get(layer.id) ?? []) add(layerBox(child), readEffects(child.effects));
    } else {
      for (const stroke of byLayer.get(layer.id) ?? []) {
        if (stroke.tool !== 'eraser') add(markBox(stroke), readEffects(stroke.effects));
      }
    }
    return box;
  };

  // Visibility and opacity are written per group and inherit through the
  // nesting (SVG multiplies a child's opacity into its ancestors'), which
  // matches how effectiveLayer resolves them for rendering.
  const emitLayer = (layer: Layer): string | null => {
    if (!layer.visible) return null;
    const li = layerIndex.get(layer.id) ?? 0;
    const name = escXml(layer.name);
    const attrs = [
      `id="${uniqueId(idFromName(layer.name) || `layer-${li}`, usedIds)}"`,
      `data-name="${name}"`,
      `inkscape:label="${name}"`,
      `inkscape:groupmode="layer"`,
    ];
    if (layer.opacity < 1) attrs.push(`opacity="${layer.opacity}"`);
    const layerEffects = readEffects(layer.effects);
    if (layerEffects) attrs.push(effectAttrs(layerEffects, layerBox(layer)));

    if (layer.group) {
      const inner = (childrenOf.get(layer.id) ?? [])
        .map(emitLayer)
        .filter((g): g is string => g !== null);
      if (inner.length === 0) return null;
      // A clip group: its clip mark written into a <clipPath> - its own path,
      // paint and all, which a clip ignores and napkin's importer reads back -
      // and the group clipped by it, keeping its name and id.
      const clip = clips.byGroup.get(layer.id);
      if (clip) {
        const clipId = uniqueId(`clip-${li}`, usedIds);
        const clipLayer = byId.get(clip.mark.layer ?? '');
        const named = clipLayer ? ` data-name="${escXml(clipLayer.name)}"` : '';
        defs.push(`<clipPath id="${clipId}"${named}>${svgPath(clip.mark, orderOf(clip.mark), defaults, undefined, defs)}</clipPath>`);
        // SVG filters a group before it clips it, and the canvas cuts the
        // picture before its effects: with effects, the clip goes on a group
        // of its own inside, which the importer reads back as this one.
        if (layerEffects) {
          return `<g ${attrs.join(' ')}>\n<g clip-path="url(#${clipId})" data-clip-inner="1">\n${inner.join('\n')}\n</g>\n</g>`;
        }
        attrs.push(`clip-path="url(#${clipId})"`);
      }
      return `<g ${attrs.join(' ')}>\n${inner.join('\n')}\n</g>`;
    }

    // A clip mark paints nothing while it clips: it is in its group's <clipPath>.
    const own = byLayer.get(layer.id) ?? [];
    const strokes = clips.any ? own.filter((s) => !clips.marks.has(s.id)) : own;
    if (strokes.length === 0) return null;

    const erasers = strokes.filter((s) => s.tool === 'eraser');
    if (erasers.length > 0) {
      const maskId = `erase-${li}`;
      defs.push(
        `<mask id="${maskId}">` +
          coverRect('#fff') +
          erasers.map((s) => svgPath(s, orderOf(s), defaults, '#000')).join('') +
          `</mask>`,
      );
      attrs.push(`mask="url(#${maskId})"`);
    }

    const marks = strokes
      .filter((s) => s.tool !== 'eraser')
      .map((s) => {
        const order = orderOf(s);
        let markup: string;
        if (isTextStroke(s)) markup = svgText(s, order);
        else if (isImageStroke(s)) markup = svgImage(s, order);
        else if (s.tool === 'copic') markup = svgCopic(s, order);
        else if (s.tool === 'pencil') markup = s.smudges?.length ? svgSmearedPencil(s, order) : svgPencil(s, order, pencilFill(s));
        else if (activeProfile(s) && !s.noStroke) markup = svgProfiled(s, order, defs);
        else markup = svgPath(s, order, defaults, undefined, defs);
        // A mark's effects go on its outermost element, which is the whole mark.
        const effects = readEffects(s.effects);
        return effects && markup ? markup.replace(/^<[a-z]+/, (tag) => `${tag} ${effectAttrs(effects, markBox(s))}`) : markup;
      })
      .filter(Boolean);

    return `<g ${attrs.join(' ')}>\n${marks.join('\n')}\n</g>`;
  };

  const groups = topLevel.map(emitLayer).filter((g): g is string => g !== null);
  // Inherited paint, stated once. `stroke-width` is only worth naming when
  // the shared width is not the 1 that SVG already defaults to.
  const rootPaint =
    ` fill="none" stroke-linecap="round" stroke-linejoin="round"` +
    (defaults.strokeWidth === 1 ? '' : ` stroke-width="${fmt(defaults.strokeWidth)}"`);
  const parts: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${width} ${height}"${rootPaint} data-generator="napkin-sketch">`,
  ];
  // A transparent document leaves no paper under the marks, which is what
  // lets a frame drop into a composition without a rectangle behind it.
  if (!options.transparent) {
    parts.push(coverRect(escXml(background)));
  }
  if (defs.length > 0) parts.push(`<defs>\n${defs.join('\n')}\n</defs>`);
  parts.push(...groups, '</svg>');
  return parts.join('\n');
}

/** A box by its edges. */
type Edges = { minX: number; minY: number; maxX: number; maxY: number };

const grown = (box: Edges, by: number): Edges => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by });

const joined = (a: Edges, b: Edges): Edges => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/** A text item's lines, as {@link svgText} breaks them. */
function textLines(stroke: Stroke): string[] {
  const text = stroke.text ?? '';
  const size = stroke.fontSize ?? 24;
  const box = stroke.textBoxWidth && stroke.textBoxWidth > 0 ? stroke.textBoxWidth : 0;
  return box > 0 ? text.split('\n').flatMap((paragraph) => wrapText(paragraph, box, { fontSize: size })) : text.split('\n');
}

/**
 * Where a mark's ink can reach: its bounds grown by its width. A text item is
 * given a generous measure, since a viewer sets it in a real face.
 */
function markBox(stroke: Stroke): Edges | null {
  const box = strokeBounds(stroke, (s) => {
    const size = s.fontSize ?? 24;
    const lines = textLines(s);
    const width = s.textBoxWidth && s.textBoxWidth > 0 ? s.textBoxWidth : Math.max(0, ...lines.map((line) => line.length)) * size * 0.65;
    return { width, height: lines.length * size * 1.25 };
  });
  if (!box) return null;
  return grown(box, isTextStroke(stroke) ? stroke.fontSize ?? 24 : isImageStroke(stroke) ? 0 : stroke.width);
}

/**
 * Formats a coordinate at two-decimal precision without trailing zeros.
 * Two decimals keep artwork authored in small user units (a sprite in a
 * 43-unit viewBox, where the source itself carries hundredths) intact on the
 * round trip; one decimal was a visible distortion at that scale.
 */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Paint that the root `<svg>` element states once for every mark below it to
 * inherit, instead of each `<path>` repeating it. `fill="none"`, round caps
 * and round joins are what a napkin mark always is; the width is whichever
 * one most of the marks on the page happen to share.
 */
interface SvgPaintDefaults {
  strokeWidth: number;
}

/**
 * The stroke width the most marks share. Ties keep the first width seen, so
 * the same page always exports the same document.
 */
function paintDefaults(sketch: Sketch): SvgPaintDefaults {
  const counts = new Map<number, number>();
  for (const stroke of sketch.strokes) {
    if (isTextStroke(stroke) || isImageStroke(stroke) || stroke.tool === 'copic' || stroke.tool === 'pencil') continue;
    // A profiled outline is filled, never stroked, so its width is no default.
    if (activeProfile(stroke) && !stroke.noStroke) continue;
    const width = round2(stroke.width);
    counts.set(width, (counts.get(width) ?? 0) + 1);
  }
  let strokeWidth = 1;
  let best = 0;
  for (const [width, n] of counts) {
    if (n > best) {
      strokeWidth = width;
      best = n;
    }
  }
  return { strokeWidth };
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Turns a layer name into an XML id, escaping everything an id may not hold
 * as `_xHH_`. Inverse of the importer's `decodeIdName`, so a name written
 * here reads back as itself in editors that show ids as object names.
 * Returns `''` for a name with nothing usable left in it.
 */
function idFromName(name: string): string {
  const escaped = name
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, (c) => `_x${c.codePointAt(0)!.toString(16).toUpperCase()}_`);
  if (escaped === '') return '';
  // XML ids must begin with a letter or an underscore.
  return /^[A-Za-z_]/.test(escaped) ? escaped : `_${escaped}`;
}

/** Uniquifies an id with the `-2`, `-3`, … suffix editors use for repeats. */
function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  for (let n = 2; used.has(candidate); n++) candidate = `${id}-${n}`;
  used.add(candidate);
  return candidate;
}

/**
 * Serialises a drawing stroke as an SVG path (or dot). `colorOverride` is
 * used for eraser strokes inside a layer's mask, where black means "hide".
 */
function svgPath(
  stroke: Stroke,
  order: number,
  defaults: SvgPaintDefaults,
  colorOverride?: string,
  defs?: string[],
): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const opacity = colorOverride ? 1 : stroke.opacity ?? defaultOpacityFor(stroke.tool);
  // `opacity` is not inherited and defaults to 1, so a fully opaque mark says
  // nothing about it; everything else here is inherited from the root element.
  const alpha = opacity === 1 ? '' : ` opacity="${opacity}"`;
  const color = escXml(colorOverride ?? stroke.color);
  const data = `data-tool="${stroke.tool}" data-i="${order}"`;
  if (pts.length === 1) {
    const p = pts[0];
    const r = fmt(stroke.width / 2);
    return `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${r}" fill="${color}"${alpha} ${data}/>`;
  }
  const d = pathD(stroke);
  // Filled shapes paint their interior (SVG auto-closes fills, so the path
  // data stays an M/L polyline and round-trips through import unchanged).
  const fill = colorOverride ? null : svgFill(stroke, order, defs);
  const fillAttrs = fill ? fill.paint + fill.data : '';
  // An outline switched off exports as `stroke="none"` - the SVG spelling of
  // a fill-only shape - with the kept color/width riding along for re-import,
  // and the profile the outline would take when it is switched back on.
  if (!colorOverride && stroke.noStroke) {
    const profile = activeProfile(stroke);
    const kept = profile ? ` data-profile="${profile}"${profileMirroredData(stroke)}` : '';
    return `<path d="${d}" stroke="none"${fillAttrs}${alpha} ${data} data-nostroke="1" data-color="${escXml(stroke.color)}" data-width="${stroke.width}"${kept}/>`;
  }
  const dash = dashPatternFor(stroke.strokeStyle, stroke.width);
  const dashAttrs =
    dash.length > 0
      ? ` stroke-dasharray="${dash.map(fmt).join(',')}" data-dash="${stroke.strokeStyle}"`
      : '';
  // The root element carries the width most marks share; only the odd one out
  // has to name its own.
  const widthAttr =
    round2(stroke.width) === defaults.strokeWidth ? '' : ` stroke-width="${fmt(stroke.width)}"`;
  return `<path d="${d}" stroke="${color}"${widthAttr}${dashAttrs}${fillAttrs}${alpha} ${data}/>`;
}

/**
 * A shape's fill as attributes: the paint, and the data napkin's importer
 * restores it from exactly (`data-fill`). A gradient registers a paint
 * server in <defs> and rides along as `data-gradient` so napkin's own
 * importer restores the editable stops rather than re-reading the server.
 * Null when the shape has no fill.
 */
function svgFill(
  stroke: Stroke,
  order: number,
  defs?: string[],
): { paint: string; data: string } | null {
  if (stroke.gradient && defs) {
    const id = `grad-${order}`;
    const server = svgGradient(stroke, id);
    if (server) {
      defs.push(server);
      const json = escXml(JSON.stringify(stroke.gradient));
      // The flat fill rides along beside the gradient: the model keeps it so
      // removing the gradient restores it, and the round trip must too.
      const kept = stroke.fill ? ` data-fill="${escXml(stroke.fill)}"` : '';
      return { paint: ` fill="url(#${id})"`, data: ` data-gradient="${json}"${kept}` };
    }
  }
  if (!stroke.fill) return null;
  const fill = escXml(stroke.fill);
  return { paint: ` fill="${fill}"`, data: ` data-fill="${fill}"` };
}

/**
 * Serialises a profiled stroke. SVG has no variable-width stroke, so the
 * outline is written as the shape the profile makes, filled in the ink - the
 * shape the canvas fills, traced as its boundary - and the stroke itself
 * rides along as data: its centreline in `data-d`, and its width, ink,
 * profile and dash, which is what napkin's importer rebuilds it from.
 *
 * A stroke with a fill as well takes two paints, so it is a group of two
 * paths - the fill, then the outline over it, the order the canvas paints
 * them in - carrying the data once, and it reads back as one mark.
 */
function svgProfiled(stroke: Stroke, order: number, defs: string[]): string {
  const profile = activeProfile(stroke);
  if (!profile) return '';
  const raw = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  const alpha = raw === 1 ? '' : ` opacity="${raw}"`;
  const ink = escXml(stroke.color);
  // The outline is derived, like Copic's chisel: its samples can be pruned.
  const outline = new PathData();
  for (const contour of profileOutline(profileInputOf(stroke))) {
    simplify(contour, EXPORT_SIMPLIFY_EPSILON).forEach((p, i) =>
      i === 0 ? outline.moveTo(p.x, p.y) : outline.lineTo(p.x, p.y),
    );
    outline.close();
  }
  const centreline = pathD(stroke);
  const dash = stroke.strokeStyle ? ` data-dash="${stroke.strokeStyle}"` : '';
  const data =
    `data-tool="${stroke.tool}" data-i="${order}" data-profile="${profile}" ` +
    `data-width="${stroke.width}" data-color="${ink}" data-d="${centreline}"${dash}` +
    profileMirroredData(stroke);
  const fill = svgFill(stroke, order, defs);
  if (!fill || stroke.points.length < 3) {
    return `<path d="${outline}" fill="${ink}"${alpha} ${data}/>`;
  }
  return (
    `<g${alpha} ${data}${fill.data}>` +
    `<path d="${centreline}"${fill.paint}/>` +
    `<path d="${outline}" fill="${ink}"/>` +
    `</g>`
  );
}

/** `data-profile-mirrored` for a stroke whose profile's sides are swapped. */
function profileMirroredData(stroke: Stroke): string {
  return stroke.profileMirrored ? ' data-profile-mirrored="1"' : '';
}

/**
 * A gradient paint server for a stroke's fill, sized to the shape's bounding
 * box in user space (`gradientUnits="userSpaceOnUse"`) so it lines up with
 * the canvas rendering exactly. Returns null when the gradient has too few
 * stops to paint or the stroke has no bounds.
 */
function svgGradient(stroke: Stroke, id: string): string | null {
  const gradient = stroke.gradient;
  const box = strokeBounds(stroke);
  const stops = gradient ? normalizedStops(gradient) : null;
  if (!gradient || !box || !stops) return null;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const body = stops
    .map((s) => `<stop offset="${fmt(s.offset * 100)}%" stop-color="${escXml(s.color)}"/>`)
    .join('');
  if (gradient.type === 'radial') {
    const r = Math.hypot(w, h) / 2;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}">${body}</radialGradient>`;
  }
  const rad = ((gradient.angle ?? 0) * Math.PI) / 180;
  const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const dx = Math.cos(rad) * reach;
  const dy = Math.sin(rad) * reach;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(cx - dx)}" y1="${fmt(cy - dy)}" x2="${fmt(cx + dx)}" y2="${fmt(cy + dy)}">${body}</linearGradient>`;
}

/**
 * Serialises a Copic stroke as its filled chisel-nib outline so external
 * viewers see the flat-nib look. The centreline samples and nib angle ride
 * along in `data-pts` / `data-nib` so importing the file restores the
 * editable stroke exactly.
 */
function svgCopic(stroke: Stroke, order: number): string {
  const polys = copicNibPolygons(stroke);
  if (polys.length === 0) return '';
  const raw = stroke.opacity ?? defaultOpacityFor('copic');
  const opacity = raw === 1 ? '' : ` opacity="${raw}"`;
  // The chisel outline is derived viewer-only data (import rebuilds it from
  // `data-pts`), so its samples can be pruned like any other polyline.
  const outline = new PathData();
  for (const poly of polys) {
    simplify(poly, EXPORT_SIMPLIFY_EPSILON).forEach((p, i) =>
      i === 0 ? outline.moveTo(p.x, p.y) : outline.lineTo(p.x, p.y),
    );
    outline.close();
  }
  const d = outline.toString();
  const pts = stroke.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
  const nib = fmt(stroke.nibAngle ?? DEFAULT_NIB_ANGLE);
  return `<path d="${d}" fill="${escXml(stroke.color)}" fill-rule="nonzero"${opacity} data-tool="copic" data-i="${order}" data-nib="${nib}" data-width="${stroke.width}" data-pts="${pts}"/>`;
}

/**
 * The paint a Pencil mark is filled with: the paper's tooth, as a pattern
 * of the one tile the file carries, whose heights a filter turns into the
 * lead's tone at the coverage the rule gives for them at `pressure` - the
 * canvas's grain, at the mark's mean pressure.
 */
function svgPencilPaint(id: string, color: string, paint: ReturnType<typeof pencilPaint>, pressure: number): string {
  const rgb = /^#([0-9a-f]{6})$/i.exec(color) ? color : paint.tone;
  const channel = (i: number): string => fmt(parseInt(rgb.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  const table: string[] = [];
  for (let i = 0; i <= 32; i++) table.push(String(Math.round(pencilCoverage(paint, i / 32, pressure) * 1000) / 1000));
  const side = fmt(GRAIN_TILE_SIZE / GRAIN_TEXELS_PER_PX);
  return (
    `<filter id="${id}-grain" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="0 0 0 0 ${channel(0)} 0 0 0 0 ${channel(1)} 0 0 0 0 ${channel(2)} 1 0 0 0 0"/>` +
    `<feComponentTransfer><feFuncA type="table" tableValues="${table.join(' ')}"/></feComponentTransfer>` +
    `</filter>` +
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${side}" height="${side}">` +
    `<use href="#pencil-tooth" filter="url(#${id}-grain)"/>` +
    `</pattern>`
  );
}

/**
 * A Pencil mark: the outline the canvas fills for it, filled with its
 * grain (`fill`, from {@link svgPencilPaint}), so a browser shows the same
 * tooth. The stroke itself rides along as data, as a profiled one's does -
 * its centreline in `data-d`, its width, tone and pencil - which is what
 * napkin's importer rebuilds it from.
 */
function svgPencil(stroke: Stroke, order: number, fill: string): string {
  if (stroke.points.length === 0) return '';
  const raw = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  const alpha = raw === 1 ? '' : ` opacity="${raw}"`;
  const outline = new PathData();
  for (const contour of profileOutline(profileInputOf(stroke))) {
    simplify(contour, EXPORT_SIMPLIFY_EPSILON).forEach((p, i) => (i === 0 ? outline.moveTo(p.x, p.y) : outline.lineTo(p.x, p.y)));
    outline.close();
  }
  const dash = stroke.strokeStyle ? ` data-dash="${stroke.strokeStyle}"` : '';
  const data =
    `data-tool="pencil" data-i="${order}" data-pencil="${escXml(pencilPaint(stroke.pencil).name)}" ` +
    `data-width="${stroke.width}" data-color="${escXml(stroke.color)}" data-d="${pathD(stroke)}"${dash}`;
  return `<path d="${outline}" fill="${fill}"${alpha} ${data}/>`;
}

/** How many image pixels a page pixel gets in a smeared Pencil mark's picture. */
const SMEARED_SCALE = 2;

/**
 * A smeared Pencil mark: SVG has no paint for graphite pushed about by a
 * stump, so the mark is written as the picture the canvas paints of it - a
 * PNG at twice the page's resolution, over its box. The mark rides along as
 * data, as a plain Pencil mark's does, and its Smear passes with it
 * (`data-smudges`), so napkin's importer brings back the mark and not the
 * picture.
 */
function svgSmearedPencil(stroke: Stroke, order: number): string {
  const region = pencilRegion(stroke, SMEARED_SCALE);
  if (!region) return '';
  const png = encodePng(pencilPicture(stroke, region), region.width, region.height);
  const raw = stroke.opacity ?? defaultOpacityFor(stroke.tool);
  const alpha = raw === 1 ? '' : ` opacity="${raw}"`;
  const dash = stroke.strokeStyle ? ` data-dash="${stroke.strokeStyle}"` : '';
  const data =
    `data-tool="pencil" data-i="${order}" data-pencil="${escXml(pencilPaint(stroke.pencil).name)}" ` +
    `data-width="${stroke.width}" data-color="${escXml(stroke.color)}" data-d="${pathD(stroke)}"${dash} ` +
    `data-smudges="${escXml(JSON.stringify(stroke.smudges))}"`;
  return (
    `<image x="${fmt(region.x / SMEARED_SCALE)}" y="${fmt(region.y / SMEARED_SCALE)}" width="${fmt(region.width / SMEARED_SCALE)}" height="${fmt(region.height / SMEARED_SCALE)}" ` +
    `preserveAspectRatio="none" href="${pngDataUrl(png)}"${alpha} ${data}/>`
  );
}

/**
 * A text item: one `<tspan>` a line. A fixed-width box wraps between words,
 * which SVG text does not do, and nothing here can measure the font the app
 * sets it in, so the lines are broken where the built-in face breaks them -
 * the measure the composition renderers use too. The text as typed and the
 * box's width ride along as `data-text` and `data-box`, so the importer
 * restores the box rather than the lines it was broken into.
 */
function svgText(stroke: Stroke, order: number): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.text) return '';
  const size = stroke.fontSize ?? 24;
  const lineHeight = size * 1.25;
  const color = escXml(stroke.color);
  const family = escXml(stroke.fontFamily ?? DEFAULT_FONT_FAMILY);
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  const box = stroke.textBoxWidth && stroke.textBoxWidth > 0 ? stroke.textBoxWidth : 0;
  const lines = box > 0 ? stroke.text.split('\n').flatMap((paragraph) => wrapText(paragraph, box, { fontSize: size })) : stroke.text.split('\n');
  // A newline in an attribute has to be a character reference, or a reader folds it into a space.
  const kept = box > 0 ? ` data-box="${fmt(box)}" data-text="${escXml(stroke.text).replace(/\n/g, '&#10;')}"` : '';
  const tspans = lines
    .map((line, i) => `<tspan x="${fmt(anchor.x)}" dy="${i === 0 ? 0 : fmt(lineHeight)}">${escXml(line)}</tspan>`)
    .join('');
  return `<text x="${fmt(anchor.x)}" y="${fmt(anchor.y)}" font-size="${size}" font-family="${family}" fill="${color}" dominant-baseline="hanging"${opacity} data-tool="text" data-i="${order}"${kept}>${tspans}</text>`;
}

/**
 * A placed image. The canvas draws an image to fill its box whatever its own
 * proportions, so the SVG says the same with `preserveAspectRatio="none"`;
 * left at SVG's default, an image stretched in the app came out letterboxed.
 *
 * A linked file is written as the reference it is - `href` the file's path,
 * with `data-link` and its name - rather than as its placeholder, so a viewer
 * that can reach the file shows the file, and the importer reads it back as a
 * link.
 */
function svgImage(stroke: Stroke, order: number): string {
  const anchor = stroke.points[0];
  if (!anchor || !stroke.image) return '';
  const w = stroke.imageWidth ?? 100;
  const h = stroke.imageHeight ?? 100;
  const opacity = typeof stroke.opacity === 'number' ? ` opacity="${stroke.opacity}"` : '';
  const link = stroke.link?.href;
  const href = link ?? stroke.image;
  const linked = link ? ` data-link="true" data-name="${escXml(linkName(link))}"` : '';
  return `<image x="${fmt(anchor.x)}" y="${fmt(anchor.y)}" width="${w}" height="${h}" preserveAspectRatio="none" href="${escXml(href)}"${linked}${opacity} data-tool="image" data-i="${order}"/>`;
}
