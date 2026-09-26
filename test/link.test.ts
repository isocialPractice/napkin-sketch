/**
 * Linked graphics: an image item that stands for a file rather than holding
 * it. The model keeps the link, the SVG writers keep the reference, the
 * rasterizer draws the file only when the host can read it, and a host reads
 * only inside the folder it names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isLinkStroke, linkKind, linkName, linkPlaceholder, linkPlaceholderSvg, safeLinkPath, type LinkResolver } from '../src/core/link.js';
import { normalizeSketchBook, parseSketchBook, serializeSketchBook } from '../src/core/serialize.js';
import { sketchesToPdf } from '../src/core/pdf.js';
import { Surface } from '../src/renderer/surface.js';
import { compositionToSvg, encodePng, inlineSvg, rasterizeComposition, type RasterResult } from '../src/core/graphic-design/index.js';
import { resolveLinkFromDir } from '../src/core/graphic-design/files.js';
import type { CompositionDocument, Element } from '../src/core/graphic-design/types.js';
import { evaluate, formatDiagnostic, type ScriptResult } from '../src/core/script/index.js';
import { imageSize } from '../src/core/script/media.js';
import type { Sketch, Stroke } from '../src/core/types.js';

const TIME = '2026-09-25T00:00:00.000Z';

function clean(text: string, options: Parameters<typeof evaluate>[1] = {}): ScriptResult {
  const result = evaluate(text, { fragment: true, timestamp: TIME, ...options });
  assert.deepEqual(result.diagnostics.map((d) => formatDiagnostic(d)), [], text);
  return result;
}

const page = (result: ScriptResult): Sketch => result.book.sketches[0];
const svgBytes = (svg: string): Uint8Array => new TextEncoder().encode(svg);

/** A resolver that serves a few files from memory. */
function memory(files: Record<string, { bytes: Uint8Array; mediaType: string }>): LinkResolver {
  return (href) => files[href] ?? null;
}

// ---- Naming, the placeholder, and the paths a host follows ------------------------------

test('a link knows its kind and its name from its path', () => {
  assert.deepEqual(
    ['assets/logo.SVG', 'photo.jpg', 'photo.jpeg?v=2', 'deck.pdf#page=2', 'mark.png', 'anim.gif', 'README', 'image.webp'].map(linkKind),
    ['svg', 'jpeg', 'jpeg', 'pdf', 'png', 'gif', 'unknown', 'unknown'],
  );
  assert.deepEqual(
    ['assets/brand/logo.svg', 'C:\\art\\mark.png', 'https://example.com/a%20b.png?x=1', 'plain.svg'].map(linkName),
    ['logo.svg', 'mark.png', 'a b.png', 'plain.svg'],
  );
});

test('the placeholder is a dashed box the placed size with the name in it, and every renderer can draw it', () => {
  const url = linkPlaceholder('logo.svg', 120, 60);
  assert.deepEqual(imageSize(url), { width: 120, height: 60 });
  const svg = linkPlaceholderSvg('logo.svg', 120, 60);
  assert.match(svg, /stroke-dasharray="6 4"/);
  assert.match(svg, />logo\.svg<\/text>/);
  assert.match(linkPlaceholderSvg('a-very-long-file-name-for-a-small-box.svg', 60, 40), /\u2026<\/text>/, 'a long name is shortened');
  const inlined = inlineSvg(svg)!;
  assert.deepEqual(inlined.notes, [], 'the rasterizer draws every part of it');
  assert.deepEqual(
    inlined.elements.map((e) => e.type),
    ['rect', 'path', 'text'],
  );
  assert.deepEqual([(inlined.elements[0] as { dash?: number[] }).dash, (inlined.elements[2] as { align?: string }).align], [[6, 4], 'center']);
});

test('a host follows a link only when it is a relative path inside its folder', () => {
  assert.deepEqual(
    ['assets/logo.svg', './logo.svg', 'a\\b.png', 'assets//deep/./x.svg'].map(safeLinkPath),
    ['assets/logo.svg', 'logo.svg', 'a/b.png', 'assets/deep/x.svg'],
  );
  for (const href of [
    '/etc/hosts',
    '\\\\server\\share\\logo.svg',
    'C:/art/logo.svg',
    'c:logo.svg',
    '../logo.svg',
    'assets/../../logo.svg',
    'assets/%2e%2e/%2e%2e/logo.svg',
    'https://example.com/logo.svg',
    'file:///C:/logo.svg',
    '',
    '.',
  ]) {
    assert.equal(safeLinkPath(href), null, href);
  }
});

test('resolveLinkFromDir reads inside its folder, and nothing outside it', () => {
  const root = mkdtempSync(join(tmpdir(), 'napkin-link-'));
  try {
    const base = join(root, 'project');
    mkdirSync(join(base, 'assets'), { recursive: true });
    writeFileSync(join(base, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
    writeFileSync(join(root, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const resolveLink = resolveLinkFromDir(base);
    const found = resolveLink('assets/logo.svg');
    assert.equal(found?.mediaType, 'image/svg+xml');
    assert.match(new TextDecoder().decode(found!.bytes), /viewBox="0 0 10 10"/);
    assert.equal(resolveLink('../secret.svg'), null);
    assert.equal(resolveLink(join(root, 'secret.svg')), null, 'an absolute path');
    assert.equal(resolveLink('assets/missing.svg'), null);
    let linked = false;
    try {
      symlinkSync(join(root, 'secret.svg'), join(base, 'assets', 'escape.svg'));
      linked = true;
    } catch {
      // Making a symbolic link needs a privilege some machines do not grant.
    }
    if (linked) assert.equal(resolveLink('assets/escape.svg'), null, 'a symbolic link out of the folder');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- The sketch model and its outputs ------------------------------------------------------

test('the loader keeps a link on an image item, and only there', () => {
  const placeholder = linkPlaceholder('logo.svg', 120, 60);
  const raw = {
    sketches: [
      {
        strokes: [
          { tool: 'image', image: placeholder, imageWidth: 120, imageHeight: 60, points: [{ x: 1, y: 2 }], link: { href: 'assets/logo.svg', kind: 'svg' } },
          { tool: 'image', image: placeholder, points: [{ x: 0, y: 0 }], link: { href: 'logo.png', kind: 'bogus' } },
          { tool: 'image', image: placeholder, points: [{ x: 0, y: 0 }], link: { href: 42 } },
          { tool: 'pen', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], link: { href: 'logo.svg', kind: 'svg' } },
        ],
      },
    ],
  };
  const strokes = normalizeSketchBook(raw, 'x').sketches[0].strokes;
  assert.deepEqual(
    strokes.map((s) => s.link),
    [{ href: 'assets/logo.svg', kind: 'svg' }, { href: 'logo.png', kind: 'png' }, undefined, undefined],
  );
  assert.deepEqual(strokes.map(isLinkStroke), [true, true, false, false]);
  const reread = parseSketchBook(serializeSketchBook(normalizeSketchBook(raw, 'x')), 'x').sketches[0].strokes[0];
  assert.deepEqual([reread.link, reread.image], [{ href: 'assets/logo.svg', kind: 'svg' }, placeholder]);
});

test('link in a script is one image item on a layer of its own, drawn as its placeholder', () => {
  const result = clean('layer "Art"\nlink "assets/logo.svg" at 10 20 size 120 60\nline 0 0 10 10');
  const sketch = page(result);
  const [linked, line] = sketch.strokes;
  assert.deepEqual([linked.tool, linked.link, linked.imageWidth, linked.imageHeight], ['image', { href: 'assets/logo.svg', kind: 'svg' }, 120, 60]);
  assert.deepEqual([linked.points[0].x, linked.points[0].y], [10, 20]);
  assert.match(linked.image!, /^data:image\/svg\+xml/);
  assert.deepEqual(imageSize(linked.image!), { width: 120, height: 60 });
  const layerOf = (s: Stroke): string => sketch.layers.find((l) => l.id === s.layer)!.name;
  assert.deepEqual([layerOf(linked), layerOf(line)], ['logo.svg', 'Art'], 'one layer row for the link, and the next mark back on its layer');
  const named = page(clean('link "assets/logo.svg" at 0 0 size 10 10 name "Brand mark"'));
  assert.ok(named.layers.some((l) => l.name === 'Brand mark'));
});

test('link takes its size from the file when the host can read it, and warns when nobody can', () => {
  const png = encodePng(new Uint8Array(40 * 20 * 4).fill(255), 40, 20);
  const resolveLink = memory({ 'art/mark.png': { bytes: png, mediaType: 'image/png' } });
  const own = page(clean('link "art/mark.png" at 0 0', { resolveLink })).strokes[0];
  const one = page(clean('link "art/mark.png" at 0 0 size 80', { resolveLink })).strokes[0];
  assert.deepEqual([own.imageWidth, own.imageHeight, one.imageWidth, one.imageHeight], [40, 20, 80, 40]);
  const blind = evaluate('link "art/mark.png" at 0 0', { fragment: true, timestamp: TIME });
  assert.deepEqual(blind.diagnostics.map((d) => d.code), ['image-size-unknown']);
  assert.match(blind.diagnostics[0].message, /without the file/);
  assert.deepEqual([page(blind).strokes[0].imageWidth, page(blind).strokes[0].imageHeight], [100, 100]);
  const codes = (text: string): string[] => evaluate(text, { fragment: true, timestamp: TIME }).diagnostics.map((d) => d.code);
  assert.deepEqual(codes('link "data:image/png;base64,iVBOR" at 0 0 size 1 1'), ['invalid-value']);
  assert.deepEqual(codes('link "  " at 0 0 size 1 1'), ['invalid-value']);
});

test('the sketch SVG writes a link as its reference, and the PDF draws its placeholder box', () => {
  const sketch = page(clean('link "assets/logo.svg" at 10 20 size 120 60 name "Logo"'));
  const svg = Surface.toSVG(sketch);
  assert.match(svg, /<image [^>]*href="assets\/logo\.svg" data-link="true" data-name="logo\.svg"/);
  assert.doesNotMatch(svg, /data:image\/svg\+xml/, 'the placeholder stays in the app');
  assert.match(svg, /data-name="Logo"/, 'inside the layer named for it');
  const pdf = sketchesToPdf([sketch]);
  assert.match(pdf, /\[6 4\] 0 d/, 'a dashed box');
  assert.match(pdf, /\(logo\.svg\) Tj/, "and the file's name");
});

// ---- Compositions --------------------------------------------------------------------------

function composition(elements: Element[]): CompositionDocument {
  return { width: 200, height: 100, units: 'px', background: '#ffffff', useGuiCanvas: false, elements, clips: [] };
}

const pixel = (raster: RasterResult, x: number, y: number): number[] => {
  const i = (y * raster.width + x) * 4;
  return [...raster.data.slice(i, i + 4)];
};

const LINKED: Element = { type: 'image', src: 'assets/logo.svg', link: true, x: 50, y: 25, width: 100, height: 50 } as Element;

test('a composition keeps a link as its href, and a fill image says fill in SVG too', () => {
  const svg = compositionToSvg(composition([LINKED]));
  assert.match(svg, /href="assets\/logo\.svg"/);
  assert.match(svg, /data-link="true"/);
  assert.match(svg, /preserveAspectRatio="none"/, 'no fit is fill, which the rasterizer stretches to');
});

test('the rasterizer draws a linked SVG through the resolver, fitted to its box and clipped to it', () => {
  // A red square that overhangs its own view box on every side.
  const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="-50" y="-50" width="200" height="150" fill="#ff0000"/></svg>';
  const raster = rasterizeComposition(composition([LINKED]), { resolveLink: memory({ 'assets/logo.svg': { bytes: svgBytes(art), mediaType: 'image/svg+xml' } }) });
  assert.deepEqual(raster.warnings, []);
  assert.deepEqual(pixel(raster, 100, 50), [255, 0, 0, 255], 'inside the box');
  assert.deepEqual(pixel(raster, 20, 50), [255, 255, 255, 255], 'outside it, clipped');
  assert.deepEqual(pixel(raster, 100, 90), [255, 255, 255, 255]);
});

test('the rasterizer draws a linked PNG from its pixels', () => {
  const rgba = new Uint8Array(2 * 1 * 4);
  rgba.set([255, 0, 0, 255, 0, 0, 255, 255]);
  const png = encodePng(rgba, 2, 1);
  const raster = rasterizeComposition(composition([{ ...LINKED, src: 'mark.png' } as Element]), {
    resolveLink: memory({ 'mark.png': { bytes: png, mediaType: 'image/png' } }),
  });
  assert.deepEqual(raster.warnings, []);
  assert.deepEqual(pixel(raster, 60, 50).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(pixel(raster, 140, 50).slice(0, 3), [0, 0, 255]);
});

test('without a resolver, or with one that cannot read the file, the placeholder is drawn and said', () => {
  const grey = (raster: RasterResult): number => {
    let n = 0;
    for (let y = 25; y < 75; y++) for (let x = 50; x < 150; x++) if (pixel(raster, x, y)[0] < 200) n++;
    return n;
  };
  const blind = rasterizeComposition(composition([LINKED]));
  assert.deepEqual(blind.warnings, ['link "assets/logo.svg" drew as its placeholder: no resolveLink was given to read it']);
  assert.ok(grey(blind) > 100, 'the dashed box and the name are drawn');
  const missing = rasterizeComposition(composition([LINKED]), { resolveLink: () => null });
  assert.deepEqual(missing.warnings, ['link "assets/logo.svg" could not be read, so its placeholder was drawn']);
  assert.equal(grey(missing), grey(blind));
});

// ---- What the rasterizer reads out of an SVG ----------------------------------------------

test('inlineSvg draws a gradient as its first stop, carries opacity and dashes, and reports what it cannot draw', () => {
  const inlined = inlineSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <linearGradient id="h" xlink:href="#g" x1="0" x2="1"/>
      <pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern>
    </defs>
    <rect id="a" width="10" height="10" fill="url(#g)"/>
    <rect id="b" width="10" height="10" fill="url(#h)"/>
    <rect id="c" width="10" height="10" fill="url(#p)"/>
    <g opacity="0.5" clip-path="url(#clip)"><rect id="d" width="10" height="10" opacity="0.5" fill="#000"/></g>
    <path id="e" d="M0 0 L10 10" stroke="#000" stroke-dasharray="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-opacity="0.5"/>
    <rect id="f" width="10" height="10" mask="url(#m)" filter="url(#blur)"/>
    <text x="50" y="50" text-anchor="middle">Acme</text>
  </svg>`)!;
  const byId = new Map(inlined.elements.map((e) => [e.id, e as unknown as Record<string, unknown>]));
  assert.deepEqual([byId.get('a')!.fill, byId.get('b')!.fill], ['#ff0000', '#ff0000'], 'a gradient is its first stop, followed through an href');
  assert.equal(byId.get('c')!.fill, null, 'a pattern paints nothing, rather than black');
  assert.equal(byId.get('d')!.opacity, 0.25, "a group's opacity multiplies into its shapes");
  const e = byId.get('e')!;
  assert.deepEqual([e.dash, e.lineCap, e.lineJoin, e.strokeOpacity], [[3, 3], 'round', 'bevel', 0.5]);
  const text = inlined.elements.find((el) => el.type === 'text') as unknown as Record<string, unknown>;
  assert.equal(text.align, 'center');
  assert.deepEqual(inlined.notes, [
    "A gradient was drawn as its first stop's colour: this API paints solids only.",
    'A pattern, or a paint that named nothing, was not drawn.',
    'A clip path was not applied.',
    'A mask was not applied.',
    'A filter was not applied.',
  ]);
});
