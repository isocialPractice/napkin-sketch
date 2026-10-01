/**
 * The public surface: what `napkin-sketch` and `napkin-sketch/node` export,
 * held to lists. Nothing the barrel exported may go - an import that breaks on
 * an upgrade is the one failure an additive release promises not to have -
 * and the names the language added must be there, both in the source a
 * bundler and `tsc` read and in the module a program imports. The package's
 * map must point each entry at what the build writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as api from '../src/api/index.js';
import * as node from '../src/api/node.js';
import * as designFiles from '../src/core/graphic-design/files.js';
import { repoRoot } from './helpers/repo-root.js';

const ROOT = repoRoot();

/** The names an entry's source exports, values and types apart, read from its `export { ... } from` lists. */
function exportsOf(file: string): { values: string[]; types: string[] } {
  const source = readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const values: string[] = [];
  const types: string[] = [];
  for (const list of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const raw of list[2].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const name = part.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      (list[1] || part.startsWith('type ') ? types : values).push(name);
    }
  }
  return { values, types };
}

/** Every value the barrel exported before the language joined it, in 1.0.0-alpha.4.3.0. */
const BARREL_VALUES_BEFORE = [
  'NapkinSketch', 'SKETCHBOOK_VERSION', 'SKETCHBOOK_EXTENSION', 'DEFAULT_SURFACE', 'DEFAULT_BACKGROUND',
  'DEFAULT_FONT_FAMILY', 'createId', 'createLayer', 'createSketch', 'createSketchBook', 'isImageStroke',
  'isTextStroke', 'layerOf', 'strokesOnLayer', 'withSketchBookExtension', 'deriveName', 'normalizeSketchBook',
  'parseSketchBook', 'serializeSketchBook', 'DEFAULT_SHARPEN_OPTIONS', 'sharpenPoints', 'sharpenStroke',
  'sharpenStrokes', 'classify', 'sketchesToPdf', 'Composition', 'ElementList', 'createComposition',
  'renderComposition', 'renderPng', 'compositionToSvg', 'rasterizeComposition', 'decodePng', 'encodePng',
  'layoutText', 'measureText', 'DEFAULT_COMPOSITION_SIZE', 'DEFAULT_FONT_SIZE', 'DEFAULT_TEXT_FONT', 'brandMark',
  'brandRegion', 'descriptorFromFilename', 'detectBrandSlots', 'findBrandSlots', 'scanBrandBands', 'fitInto',
  'inlineSvg', 'normalizeResourceKey', 'parseResources', 'placeBrand', 'importSvg', 'Surface', 'strokeBounds',
];

/** Every type the barrel exported before the language joined it. */
const BARREL_TYPES_BEFORE = [
  'NapkinOptions', 'Layer', 'Point', 'Stroke', 'Sketch', 'SketchBook', 'Tool', 'SharpenOptions', 'ShapeKind',
  'CompositionDocument', 'CompositionFormat', 'DesignElement', 'PageOptions', 'ParagraphStyle', 'RasterOptions',
  'RasterResult', 'RenderOptions', 'SvgOptions', 'TextStyle', 'BrandBox', 'BrandBand', 'BrandDetection',
  'BrandScan', 'BrandSlot', 'PixelSource', 'BrandMarkOptions', 'BrandPalette', 'BrandRegion', 'BrandSource',
  'InlinedVector', 'ParsedResources', 'PlaceBrandOptions', 'PlacedBrand', 'ResourceEntry', 'ImportedLayer',
  'ImportedSvg', 'SvgImportOptions', 'LiveStroke', 'Overlay',
];

/** The language's values in the barrel, and what each is. */
const LANGUAGE_VALUES: Record<string, 'function' | 'object' | 'number'> = {
  parseScript: 'function',
  validateScript: 'function',
  formatScript: 'function',
  formatDiagnostic: 'function',
  evaluate: 'function',
  drawSvg: 'function',
  renderSketch: 'function',
  renderBook: 'function',
  inkBox: 'function',
  renderBox: 'function',
  sketchToComposition: 'function',
  RENDER_FORMATS: 'object',
  SCRIPT_VERSION: 'number',
  SCRIPT_LIMITS: 'object',
  VERBS: 'object',
  DIAGNOSTICS: 'object',
};

/** The language's types in the barrel: the plan's list, and the shapes its calls take and give. */
const LANGUAGE_TYPES = [
  'Instruction', 'Diagnostic', 'EvaluateOptions', 'ScriptResult', 'ScriptLimits', 'LinkResolver', 'RenderFormat',
  'RenderSketchOptions', 'Box', 'CropHint', 'DiagnosticCode', 'DiagnosticSpec', 'DrawSvgOptions', 'DrawSvgResult',
  'OutputHints', 'RenderCrop', 'ScriptSource', 'ScriptStats', 'SketchCompositionOptions', 'VerbSpec',
];

test('the barrel still exports every name it did before the language joined it', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of BARREL_VALUES_BEFORE) {
    assert.ok(now.values.includes(name), `the barrel's source still exports ${name}`);
    assert.notEqual((api as Record<string, unknown>)[name], undefined, `and the module still gives ${name}`);
  }
  for (const name of BARREL_TYPES_BEFORE) assert.ok(now.types.includes(name), `the barrel still exports the type ${name}`);
});

test('the barrel exports the language, browser-safe', () => {
  const now = exportsOf('src/api/index.ts');
  for (const [name, kind] of Object.entries(LANGUAGE_VALUES)) {
    assert.ok(now.values.includes(name), `the barrel's source exports ${name}`);
    assert.equal(typeof (api as Record<string, unknown>)[name], kind, `${name} is a ${kind}`);
  }
  for (const name of LANGUAGE_TYPES) assert.ok(now.types.includes(name), `the barrel exports the type ${name}`);
  const all = [...now.values, ...now.types];
  assert.deepEqual(all.filter((name, i) => all.indexOf(name) !== i), [], 'no name is exported twice');
  const source = readFileSync(join(ROOT, 'src', 'api', 'index.ts'), 'utf8');
  assert.doesNotMatch(source, /from '(node:[^']+|[^']*script-files\.js|[^']*graphic-design\/files\.js)'/, 'the file half stays out of the browser barrel');
  assert.equal(api.SCRIPT_VERSION, 1);
  assert.deepEqual([...api.RENDER_FORMATS], ['svg', 'png', 'pdf', 'skbk', 'jsx']);
});

test('the barrel exports the Illustrator script writer beside the PDF writer', () => {
  const now = exportsOf('src/api/index.ts');
  assert.ok(now.values.includes('sketchesToJsx'), 'the barrel exports sketchesToJsx');
  assert.ok(now.types.includes('JsxOptions'), 'and the type JsxOptions');
  assert.equal(typeof api.sketchesToJsx, 'function');
  assert.match(api.sketchesToJsx([api.createSketch('card')]), /^\/\/@target illustrator\n/);
});

test('the barrel exports effects: their names, the reader, and the canvas filter', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['EFFECT_TYPES', 'cssFilter', 'readEffects']) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  for (const name of ['Effect', 'EffectType']) assert.ok(now.types.includes(name), `the barrel exports the type ${name}`);
  assert.deepEqual([...api.EFFECT_TYPES], ['blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'invert', 'hue-rotate', 'opacity', 'drop-shadow']);
  assert.equal(api.cssFilter([{ type: 'blur', radius: 2 }]), 'blur(2px)');
});

test('the barrel exports paint: the two targets, and the rules of the fill and stroke control', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['COLOR_TARGETS', 'paintPatch', 'swapPaint']) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  assert.ok(now.types.includes('ColorTarget'), 'and the type ColorTarget');
  assert.deepEqual([...api.COLOR_TARGETS], ['stroke', 'fill']);
  const square = { id: 's', tool: 'pen' as const, color: '#1f2328', width: 2, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 0 }] };
  assert.deepEqual(api.paintPatch(square, 'fill', '#e9c46a'), { fill: '#e9c46a', gradient: undefined });
  assert.deepEqual(api.swapPaint(square), { fill: '#1f2328', noStroke: true });
});

test('the barrel exports region geometry: the boolean engine, erasing, the wipes, stacking and splitting', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['booleanOp', 'booleanRegions', 'eraseKind', 'eraseMarks', 'eraseRegionOf', 'wipeMarks', 'wipeOperand', 'arrangeFaces', 'WIPE_OPS', 'stackArrangement', 'stackEdit', 'stackFaces', 'faceAt', 'facesAlong', 'facesInBox', 'nearestOnMark', 'splitMark', 'splitTarget', 'isSplittable']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['BooleanOp', 'EraseResult', 'WipeOp', 'WipeResult', 'MarkEdit', 'Face', 'StackArrangement', 'StackMode', 'StackResult', 'SplitPoint', 'SplitPieces']) assert.ok(now.types.includes(name), `and the type ${name}`);
  const square = (x0: number, y0: number, x1: number, y1: number) => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
  assert.equal(api.booleanOp(square(0, 0, 10, 10), square(5, 5, 15, 15), 'union')?.length, 1, 'two overlapping squares unite into one contour');
  assert.deepEqual([...api.WIPE_OPS], ['in', 'out-front', 'out-back', 'mid', 'outer', 'clean']);
  assert.equal(api.arrangeFaces([square(0, 0, 10, 10), square(5, 5, 15, 15)]).faces.length, 3);
  const mark = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
    id,
    tool: 'pen' as const,
    color: '#1f2328',
    width: 2,
    fill: '#e9c46a',
    layer: `ly_${id}`,
    points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }],
  });
  const page = { ...api.createSketch('stack'), layers: ['a', 'b'].map((id) => ({ id: `ly_${id}`, name: id, opacity: 1, visible: true, locked: false })), strokes: [mark('a', 0, 0, 10, 10), mark('b', 5, 5, 15, 15)] };
  const stacked = api.stackFaces(page, ['a', 'b'], [{ x: 7, y: 7 }], 'remove');
  assert.deepEqual([...stacked.changed.keys()].sort(), ['a', 'b'], 'the overlap taken from both squares');
  const line = mark('l', 0, 0, 10, 10);
  const cut = api.splitMark(line, api.nearestOnMark(line, { x: 10, y: 5 })!);
  assert.equal(cut?.second, null, 'a closed square opened, one mark');
  assert.equal(cut?.first.vector?.closed, false);
});

test('the barrel exports the Pencil and the Smear: the kit, the grain, a mark\'s picture and a stump\'s pass', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['DEFAULT_PENCIL', 'GRAIN_TILE_SIZE', 'PENCIL_GRADES', 'PENCIL_KIT', 'grainTile', 'parsePencil', 'pencilCoverage', 'pencilGrade', 'pencilMeanCoverage', 'pencilPaint', 'pencilPicture', 'pencilRegion', 'pencilWidth', 'rasterizePencil', 'DEFAULT_SMEAR_STRENGTH', 'mapSmudges', 'smearReaches', 'smudgeBuffer', 'smudgeFor', 'widthAtPressure']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['PencilChoice', 'PencilGrade', 'PencilMedium', 'PencilRegion', 'SmudgePass', 'SmudgeState', 'Smudge']) assert.ok(now.types.includes(name), `and the type ${name}`);
  assert.equal(api.PENCIL_GRADES.length, 30);
  assert.deepEqual(api.parsePencil('vine soft'), { medium: 'vine', grade: 'Soft' });
  assert.equal(api.grainTile().length, api.GRAIN_TILE_SIZE ** 2);
  const line = { id: 'l', tool: 'pencil' as const, color: '#6a6d72', width: 3, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], pencil: { medium: 'graphite' as const, grade: 'HB' } };
  const pass = api.smudgeFor(line, [{ x: 0, y: 50 }, { x: 120, y: 50 }], 20, api.DEFAULT_SMEAR_STRENGTH);
  assert.ok(pass && pass.width === 20, 'a drag across the line leaves a pass on it');
  const region = api.pencilRegion({ ...line, smudges: [pass] }, 1)!;
  assert.equal(api.pencilPicture({ ...line, smudges: [pass] }, region).length, region.width * region.height * 4);
});

test("the barrel exports Liquify: the four brushes' fields, the marks a drag bends, and the refit", () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['LIQUIFY_MODES', 'liquifiable', 'liquifyFalloff', 'liquifyField', 'liquifyMarks', 'liquifyReaches', 'refitLiquified']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['LiquifyDab', 'LiquifyMode', 'LiquifyOptions', 'PointMap']) assert.ok(now.types.includes(name), `and the type ${name}`);
  assert.deepEqual(api.LIQUIFY_MODES.map((m) => m.id), ['warp', 'twirl', 'pucker', 'bloat']);
  const line = { id: 'l', tool: 'pen' as const, color: '#000000', width: 2, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] };
  const bent = api.liquifyMarks([line], [{ mode: 'warp', x: 50, y: 50, radius: 30, dx: 0, dy: 20 }], { refit: 0.5 }).get('l');
  assert.ok(bent && Math.max(...bent.points.map((p) => p.y)) > 65, 'a push across a line bends it');
  assert.deepEqual(api.liquifyField({ mode: 'bloat', x: 0, y: 0, radius: 10, amount: 0.5 }).point({ x: 20, y: 0 }), { x: 20, y: 0 }, 'nothing past the rim moves');
});

test('the barrel exports clipping masks: making, releasing, and what a clip shows', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['CLIP_GROUP_NAME', 'canClip', 'clipIndex', 'clipMarkOf', 'clipRegionOf', 'clippedAt', 'makeClip', 'normalizeClips', 'releaseClip', 'shownBounds']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['Clip', 'ClipIndex', 'ClipProblem']) assert.ok(now.types.includes(name), `and the type ${name}`);
  const mark = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
    id,
    tool: 'pen' as const,
    color: '#1f2328',
    width: 2,
    layer: `ly_${id}`,
    points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }],
  });
  const page = { ...api.createSketch('clip'), layers: ['a', 'b'].map((id) => ({ id: `ly_${id}`, name: id, opacity: 1, visible: true, locked: false })), strokes: [mark('a', 0, 0, 40, 40), mark('b', 10, 10, 20, 20)] };
  const plan = api.makeClip(page, ['a', 'b']);
  assert.ok('clip' in plan && plan.clip.id === 'b', 'the top mark clips');
  assert.equal(api.CLIP_GROUP_NAME, 'Clip Group');
});

test('napkin-sketch/node exports the host, and every composition file helper beside it', () => {
  const host = ['drawFile', 'drawToFiles', 'readScript', 'loadAssets', 'loadDocuments', 'writeBook', 'resolveLinkFromDir'];
  for (const name of host) assert.equal(typeof (node as Record<string, unknown>)[name], 'function', `${name} is exported`);
  for (const name of Object.keys(designFiles)) {
    assert.equal((node as Record<string, unknown>)[name], (designFiles as Record<string, unknown>)[name], `${name} is re-exported as it is`);
  }
  const types = exportsOf('src/api/node.ts').types;
  for (const name of ['DrawResult', 'DrawToFilesOptions', 'WriteBookOptions', 'WrittenFile']) {
    assert.ok(types.includes(name), `napkin-sketch/node exports the type ${name}`);
  }
});

test('the package map points each entry at what the build writes', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.exports['.'], { types: './dist/api/index.d.ts', import: './dist/api/index.js', default: './dist/api/index.js' });
  assert.deepEqual(pkg.exports['./node'], { types: './dist/api/node.d.ts', import: './dist/node/index.js', default: './dist/node/index.js' });
  assert.deepEqual(pkg.exports['./graphic-design/files'], {
    types: './dist/core/graphic-design/files.d.ts',
    import: './dist/graphic-design/files.js',
    default: './dist/graphic-design/files.js',
  });
  assert.ok(pkg.files.includes('docs/api'), 'the documentation ships with the package');
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(build, /entryPoints: \[resolve\(root, 'src\/api\/node\.ts'\)\],\s*outfile: resolve\(root, 'dist\/node\/index\.js'\)/, 'the build writes the node entry');
  assert.match(build, /'dist\/node'/, 'and scopes its folder to ESM');
});

test('drawSvg draws a script\'s first page in one call, cut as the script asks', () => {
  const { ok, svg, diagnostics } = api.drawSvg('napkin 1\npage 400 300\ncrop auto pad 10\nwidth 4\nline 50 50 150 50\nnewpage\ncircle 200 150 40\n');
  assert.equal(ok, true);
  assert.deepEqual(diagnostics, []);
  assert.match(svg, /viewBox="38 38 124 24"/, "the script's own crop, the line grown by half its width and then the pad");
  assert.equal(svg.match(/<path /g)?.length, 1, 'page one only: its line, and not the circle on page two');
  const whole = api.drawSvg('napkin 1\npage 400 300\ncrop auto\nline 50 50 150 50\n', { crop: 'none', transparent: true });
  assert.match(whole.svg, /viewBox="0 0 400 300"/, 'the options win over the script');
  assert.doesNotMatch(whole.svg, /<rect[^>]*fill="#fcfaf5"/, 'and a transparent page has no paper');
  const broken = api.drawSvg('napkin 1\ncircl 10 10 5\nline 0 0 10 10\n');
  assert.equal(broken.ok, false, 'a script with an error says so');
  assert.deepEqual(broken.diagnostics.map((d) => d.code), ['unknown-verb']);
  assert.match(broken.svg, /<path /, 'and still draws what it could');
});
