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
