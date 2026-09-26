/**
 * A fixture SVG's marks as a sketch, read with no DOM.
 *
 * The geometry comes from the importer's own DOM-free readers - `parsePathD`
 * for a path, `elementSubpaths` for a basic shape - and one element is one
 * stroke, its later subpaths opening at `move` anchors, as the importer
 * builds it. Paint is read from the element's attributes, its `style`, the
 * class rules in any `<style>` block, and what it inherits from the groups
 * around it. A gradient fill keeps its kind and stops. A mark napkin wrote
 * with a stroke profile comes back as that profile, from its data, and a
 * leading rect that covers the page is the paper, as the importer reads it.
 *
 * It is not the importer, and it reads no transform, text or image: none of
 * the fixtures it is used on has a transform, and text and images are tested
 * on their own. What it is for is real-world geometry - an editor's curves,
 * compound paths and arcs - to put through two outputs and compare.
 */

import { elementSubpaths, parsePathD, sampleAnchors, type ParsedSubpath } from '../../src/core/path-data.js';
import {
  createSketch,
  type Gradient,
  type Point,
  type Sketch,
  type Stroke,
  type StrokeProfile,
  type VectorAnchor,
} from '../../src/core/types.js';

/** A tag: its name, its attributes, and whether it opens, closes, or is both. */
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** Elements whose content is never drawn where it stands. */
const HIDDEN = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'marker', 'style', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient']);

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** The paint properties read, as CSS names. */
const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'display'];

type Paint = Map<string, string>;

function attributesOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(m[1], m[2] ?? m[3] ?? '');
  return out;
}

function declarations(css: string): Paint {
  const out: Paint = new Map();
  for (const part of css.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return out;
}

/** An element's own paint: presentation attributes, then class rules over them, then its `style` over both. */
function ownPaint(attrs: Map<string, string>, classes: Map<string, Paint>): Paint {
  const own: Paint = new Map();
  for (const name of PAINT) {
    const value = attrs.get(name);
    if (value !== undefined) own.set(name, value);
  }
  for (const cls of (attrs.get('class') ?? '').split(/\s+/)) {
    for (const [name, value] of classes.get(cls) ?? []) own.set(name, value);
  }
  for (const [name, value] of declarations(attrs.get('style') ?? '')) own.set(name, value);
  return own;
}

interface FixtureGradient {
  type: 'linear' | 'radial';
  stops: Array<{ offset: number; color: string }>;
  href?: string;
}

/** Every gradient in the file by id, an `href` borrowing another's stops as editors write a family of them. */
function gradientsOf(svg: string): Map<string, FixtureGradient> {
  const found = new Map<string, FixtureGradient>();
  const blocks = /<(linearGradient|radialGradient)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of svg.matchAll(blocks)) {
    const attrs = attributesOf(m[2]);
    const id = attrs.get('id');
    if (!id) continue;
    const stops = [...(m[3] ?? '').matchAll(/<stop\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g)].map((s) => {
      const stop = attributesOf(s[1]);
      const style = declarations(stop.get('style') ?? '');
      const raw = stop.get('offset') ?? '0';
      const offset = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
      return { offset: Number.isFinite(offset) ? offset : 0, color: style.get('stop-color') ?? stop.get('stop-color') ?? '#000000' };
    });
    const href = (attrs.get('href') ?? attrs.get('xlink:href'))?.replace(/^#/, '');
    found.set(id, { type: m[1] === 'radialGradient' ? 'radial' : 'linear', stops, ...(href ? { href } : {}) });
  }
  for (const gradient of found.values()) {
    if (gradient.stops.length === 0 && gradient.href) gradient.stops = found.get(gradient.href)?.stops ?? [];
  }
  return found;
}

/** A paint value as a color, or null for none; a gradient's id is returned through `gradient`. */
function colorOf(value: string | undefined, fallback: string | null): { color: string | null; gradient?: string } {
  if (value === undefined) return { color: fallback };
  const v = value.trim();
  if (v === 'none' || v === 'transparent') return { color: null };
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(v);
  if (url) return { color: null, gradient: url[1] };
  if (v === 'currentColor' || v === 'inherit') return { color: '#000000' };
  return { color: v };
}

/** One element's subpaths as one stroke's anchors and points, as the importer joins them. */
function geometryOf(subpaths: ParsedSubpath[]): { anchors: VectorAnchor[]; points: Point[]; closed: boolean } | null {
  const anchors: VectorAnchor[] = [];
  const points: Point[] = [];
  for (const sub of subpaths) {
    const mapped = sub.anchors.map((a) => ({ ...a }));
    const sampled = sampleAnchors(mapped, sub.closed).map((p) => ({ x: p.x, y: p.y, pressure: 0.5, ...(p.move ? { move: true as const } : {}) }));
    if (sampled.length < 2) continue;
    if (anchors.length > 0) {
      mapped[0].move = true;
      sampled[0].move = true;
    }
    anchors.push(...mapped);
    points.push(...sampled);
  }
  if (points.length < 2) return null;
  return { anchors, points, closed: subpaths.every((sub) => sub.closed) };
}

/** A fixture's drawable marks, on one layer of a page its view box's size, on white. */
export function fixtureSketch(svg: string, name = 'fixture'): Sketch {
  const view = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/[\s,]+/).map(Number);
  const [minX, minY, width, height] = view && view.length === 4 ? view : [0, 0, 400, 300];
  const sketch = createSketch(name);
  sketch.width = Math.ceil(width);
  sketch.height = Math.ceil(height);
  sketch.background = '#ffffff';
  const layer = sketch.layers[0].id;

  const classes = new Map<string, Paint>();
  for (const style of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const rule of style[1].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls = declarations(rule[2]);
      for (const selector of rule[1].split(',')) {
        const cls = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1];
        if (cls) classes.set(cls, new Map([...(classes.get(cls) ?? []), ...decls]));
      }
    }
  }
  const gradients = gradientsOf(svg);

  // Inherited paint, one entry for each open group; hidden content is skipped by depth.
  const inherited: Paint[] = [new Map()];
  let hiddenDepth = 0;
  let n = 0;
  for (const m of svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(TAG)) {
    const [, closing, tag, rest, selfClosing] = m;
    if (hiddenDepth > 0) {
      if (HIDDEN.has(tag)) hiddenDepth += closing ? -1 : selfClosing ? 0 : 1;
      continue;
    }
    if (HIDDEN.has(tag)) {
      if (!closing && !selfClosing) hiddenDepth = 1;
      continue;
    }
    if (tag === 'g' || tag === 'svg') {
      if (closing) inherited.pop();
      else if (!selfClosing) inherited.push(new Map([...inherited[inherited.length - 1], ...ownPaint(attributesOf(rest), classes)]));
      continue;
    }
    if (closing || !SHAPES.has(tag)) continue;

    const attrs = attributesOf(rest);
    const paint = new Map([...inherited[inherited.length - 1], ...ownPaint(attrs, classes)]);
    if (paint.get('display') === 'none') continue;
    const first = n === 0;
    const id = `${tag}-${n++}`;

    // The paper: the first shape, a rect that is no napkin mark and covers the whole page.
    const at = (name: string): number => parseFloat(attrs.get(name) ?? '0') || 0;
    if (first && tag === 'rect' && !attrs.has('data-tool') && at('x') <= minX && at('y') <= minY && at('width') >= width && at('height') >= height) {
      const paper = colorOf(paint.get('fill'), '#000000').color;
      if (paper) sketch.background = paper;
      continue;
    }

    // A profiled napkin mark: the stroke is in its data, the outline only a picture of it.
    const profile = attrs.get('data-profile') as Exclude<StrokeProfile, 'uniform'> | undefined;
    const centreline = attrs.get('data-d');
    if (profile && centreline) {
      const geometry = geometryOf(parsePathD(centreline) ?? []);
      if (!geometry) continue;
      sketch.strokes.push({
        id,
        tool: attrs.get('data-tool') === 'marker' ? 'marker' : 'pen',
        color: attrs.get('data-color') ?? '#000000',
        width: Number(attrs.get('data-width')) || 1,
        layer,
        profile,
        points: geometry.points.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })),
        vector: { anchors: shift(geometry.anchors, minX, minY), closed: geometry.closed },
      });
      continue;
    }

    const subpaths = tag === 'path' ? parsePathD(attrs.get('d') ?? '') : elementSubpaths(tag, (name) => attrs.get(name) ?? null);
    const geometry = geometryOf(subpaths ?? []);
    if (!geometry) continue;
    const fill = colorOf(paint.get('fill'), '#000000');
    const stroke = colorOf(paint.get('stroke'), null);
    const server = fill.gradient ? gradients.get(fill.gradient) : undefined;
    const gradient: Gradient | undefined =
      server && server.stops.length >= 2
        ? { type: server.type, ...(server.type === 'linear' ? { angle: 90 } : {}), stops: server.stops }
        : undefined;
    const fillColor = fill.color ?? (gradient ? gradient.stops[0].color : null);
    if (!fillColor && !stroke.color) continue;
    const dashed = (paint.get('stroke-dasharray') ?? 'none') !== 'none';
    const mark: Stroke = {
      id,
      tool: 'pen',
      color: stroke.color ?? '#000000',
      width: parseFloat(paint.get('stroke-width') ?? '1') || 1,
      layer,
      points: geometry.points.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })),
      vector: { anchors: shift(geometry.anchors, minX, minY), closed: geometry.closed },
      ...(fillColor ? { fill: fillColor } : {}),
      ...(gradient ? { gradient } : {}),
      ...(stroke.color ? {} : { noStroke: true }),
      ...(dashed && stroke.color ? { strokeStyle: 'dashed' as const } : {}),
    };
    sketch.strokes.push(mark);
  }
  return sketch;
}

/** Anchors moved so the view box's corner is the page's origin. */
function shift(anchors: VectorAnchor[], dx: number, dy: number): VectorAnchor[] {
  if (dx === 0 && dy === 0) return anchors;
  const move = (p: { x: number; y: number }) => ({ x: p.x - dx, y: p.y - dy });
  return anchors.map((a) => ({ ...a, p: move(a.p), ...(a.hIn ? { hIn: move(a.hIn) } : {}), ...(a.hOut ? { hOut: move(a.hOut) } : {}) }));
}
