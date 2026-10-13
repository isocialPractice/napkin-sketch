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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test('the barrel exports effects: their names, the reader, the canvas filter, and the pixel passes', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['EFFECT_TYPES', 'EFFECT_DEFAULTS', 'EFFECT_LABELS', 'cssFilter', 'readEffects', 'activeEffects', 'defaultEffect', 'effectPlan', 'runEffects', 'markParts']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['Effect', 'EffectType', 'EffectTarget', 'EffectShade', 'FxImage']) assert.ok(now.types.includes(name), `the barrel exports the type ${name}`);
  assert.deepEqual(
    [...api.EFFECT_TYPES],
    ['blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'invert', 'hue-rotate', 'opacity', 'drop-shadow', 'feather', 'bevel', 'emboss', 'inner-shadow', 'outer-glow', 'inner-glow', 'splatter', 'warp', '3d'],
  );
  assert.equal(api.cssFilter([{ type: 'blur', radius: 2 }]), 'blur(2px)');
  assert.equal(api.EFFECT_LABELS['drop-shadow'], 'Outer Shadow');
  assert.equal(api.defaultEffect('outer-glow').blend, 'sheer');
});

test('the barrel exports Napkin Blends: the modes and their names, and the math that mixes them', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['BLEND_MODES', 'BLEND_MODE_IDS', 'BLEND_MODE_NAMES', 'blendChannel', 'blendColor', 'blendModeInfo', 'blendModeOf', 'blendPixel', 'compositeOperation', 'isBlended', 'isSeparable']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['BlendFamily', 'BlendMode', 'BlendModeId', 'GlobalCompositeOperationName', 'Rgb', 'Rgba', 'SeparableBlendModeId']) assert.ok(now.types.includes(name), `and the type ${name}`);
  assert.equal(api.BLEND_MODES.length, 16);
  assert.equal(api.blendModeOf('Multiply'), 'stack');
  assert.deepEqual(api.blendPixel('stack', [1, 0.8, 0, 1], [0.2, 0.6, 1, 1]).map((v) => Math.round(v * 100) / 100), [0.2, 0.48, 0, 1]);
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

test("the barrel exports the appearance stack and the pixel passes: the panel's sections, its pure edits, and effects drawn over a picture", () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'GEOMETRY_EFFECT_TYPES', 'MARK_ONLY_EFFECT_TYPES', 'activeGeometryEffects', 'effectPaintReach', 'readEffect',
    'BLEND_FIELD_CHOICES', 'EFFECT_FIELDS', 'EFFECT_ORIGINS', 'addEffect', 'aimedAt', 'appearanceSections', 'duplicateEffect', 'effectFieldValue', 'effectName',
    'effectsAfterTransform', 'expandAppearance', 'geometryShape', 'hasGeometryEffects', 'inDrawingOrder', 'isGeometryEffect', 'moveEffect', 'partOnly',
    'registerGeometryEffect', 'removeEffect', 'replaceEffect', 'retargetEffect', 'sameEffects', 'splitsParts', 'targetOf', 'toggleEffect', 'withEffectField',
    'blankImage', 'blurPixels', 'fromRgba8', 'imageInkBox', 'layOnto', 'toRgba8',
  ];
  for (const name of values) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  for (const name of ['FxBox', 'FxImage', 'FxUnder', 'FxWarn', 'ReliefEffect', 'ThreeDLight', 'ThreeDShading']) assert.ok(now.types.includes(name), `and the type ${name}`);
  // The engines page's example: an edit gives a new list, and the panel's sections sort it by target.
  let effects = api.addEffect([], api.defaultEffect('outer-glow'));
  effects = api.addEffect(effects, api.defaultEffect('bevel'), 'fill');
  effects = api.toggleEffect(effects, 0);
  const sections = api.appearanceSections(effects);
  assert.deepEqual([sections.fill.length, sections.object.length, effects[0].on], [1, 1, false]);
  const data = new Uint8ClampedArray(9 * 9 * 4);
  data.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
  const img = api.fromRgba8(data, 9, 9);
  assert.deepEqual(api.runEffects(img, [{ type: 'blur', radius: 1 }], [1, 0, 0, 1, 0, 0], () => {}), [], 'nothing laid under it apart');
  const out = api.toRgba8(img);
  assert.ok(out[(4 * 9 + 4) * 4 + 3] < 255 && out[(4 * 9 + 5) * 4 + 3] > 0, 'the blur spreads the white pixel to its neighbour');
});

test('the barrel exports Splatter, Warp and 3D: the hatch, the twelve styles, the solids and their faces', () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'SPLATTER_MAX_PASSES', 'SPLATTER_PRESETS', 'SPLATTER_PRESET_LABELS', 'SPLATTER_PRESET_NAMES', 'matchingPreset', 'splatterAnchors', 'splatterPaths', 'splatterPresetOf',
    'WARP_PARTS', 'WARP_STYLES', 'WARP_STYLE_LABELS', 'WARP_STYLE_ORIGINS', 'warpPartFor', 'warpPartsOf', 'warpStyleMap', 'warpStyleOf',
    'bindGeometry', 'drawnMark', 'drawnMarks', 'drawnPart', 'geometryOf', 'geometryParts',
    'extrudeMesh', 'revolveMesh', 'revolveStepCount', 'triangulate', 'buildSolid', 'projectPoint', 'render3d', 'renderSolid', 'threeDView', 'viewOf', 'viewPoint',
  ];
  for (const name of values) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  const types = ['SplatterOptions', 'WarpMap', 'WarpStyle', 'DrawnGeometry', 'ThreeDMesh', 'MeshFace', 'ThreeDOutline', 'RevolveShape', 'ThreeDFace', 'Solid', 'ThreeDEffect', 'ThreeDView'];
  for (const name of types) assert.ok(now.types.includes(name), `and the type ${name}`);
  const square = [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }]];
  assert.equal(api.splatterPaths(square, { ...api.SPLATTER_PRESETS.sharp, seed: 1 }).length, 1, 'one hatch for one region');
  assert.equal(api.WARP_STYLES.length, 12);
  const arc = api.warpStyleMap('arc', { minX: 0, minY: 0, maxX: 200, maxY: 100 }, { orientation: 'horizontal', bend: 50, distortH: 0, distortV: 0, part: 'whole' });
  const corner = arc.point({ x: 0, y: 0 });
  assert.deepEqual([Math.round(corner.x), Math.round(corner.y)], [-25, 52], 'an arc swings its corner out and down');
  const block = api.extrudeMesh({ rings: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]], closed: true }, 20, true);
  assert.deepEqual([block.faces.length, block.faces.filter((face) => face.kind === 'cap').length, block.closed], [6, 2, true]);
  assert.equal(api.triangulate([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]).triangles.length, 2);
});

test("the barrel exports the 3D gumball's sums: its layout, what a point is on, and what a drag does", () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['cancelGumballDrag', 'dragGumball', 'eulerOf', 'gumballHit', 'gumballLayout', 'gumballMoved', 'startGumballDrag', 'trackballTurn']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['GumballDrag', 'GumballHandle', 'GumballKeys', 'GumballLayout', 'GumballObject']) assert.ok(now.types.includes(name), `and the type ${name}`);
  // A turn read back from a matrix: none from the identity, and none from a drag that has not moved.
  assert.deepEqual(api.eulerOf([1, 0, 0, 0, 1, 0, 0, 0, 1]).map((v) => Math.round(v) + 0), [0, 0, 0]);
  assert.deepEqual(api.trackballTurn([10, 20, 30], 0, 0, 100).map((v) => Math.round(v)), [10, 20, 30]);
});

test('the barrel exports arc length: a path walked by distance, and the nearest length to a point', () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['cubicAt', 'cubicDerivative', 'curvatureAtLength', 'lengthTable', 'nearestLength', 'normalAtLength', 'pointAtLength', 'segmentTAtLength', 'tangentAtLength']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['LengthTable', 'Vec']) assert.ok(now.types.includes(name), `and the type ${name}`);
  const line = api.lengthTable([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }]);
  assert.equal(line.total, 100);
  assert.deepEqual(api.pointAtLength(line, 25), { x: 25, y: 0 });
  const near = api.nearestLength(line, { x: 40, y: 10 });
  assert.deepEqual([near.length, near.point.x, near.distance].map((v) => Math.round(v)), [40, 40, 10]);
});

test("the barrel exports type: its model, its layout, hyphenation, the panel's readers, and the font reader that draws it as shapes", () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'CHAR_KEYS', 'CONFIG_KEYS', 'CONFIG_NAME_MAX', 'DEFAULT_CHAR', 'DEFAULT_PARA', 'PARA_KEYS', 'TYPE_LIMITS', 'applyChar', 'applyPara', 'baseAttrs', 'charAttrsAt',
    'paraAttrsOf', 'paragraphAt', 'paragraphRanges', 'readCharAttrs', 'readParaAttrs', 'readTextConfig', 'readTextConfigs', 'readTypeset', 'recolorText', 'restyleText',
    'sameConfigName', 'spliceText', 'styleSegments', 'typeSpecOf', 'withTypeset', 'glyphCorners', 'layoutForEditing', 'layoutType', 'typeSpans', 'HEADLESS_MEASURE',
    'HYPHENATION_NOTICE', 'ILLUSTRATOR_LIMITS', 'TEX_LIMITS', 'hyphenatable', 'hyphenate', 'hyphenationPoints', 'applyTypeChange', 'readTargets', 'typingAttrsAt',
    'typeOnPath', 'typeablePath', 'TYPE_OPTION_FIELDS', 'typeOptionValues', 'typeOptionsKindOf', 'withTypeOptions', 'glyphOutline', 'isSfntProblem', 'openSfnt',
    'sfntFaceNames', 'facesFromFiles', 'fileOutlineSource', 'outlineSource', 'outlineText', 'setOutlineSource', 'sfntMeasure', 'withOutlineSource',
  ];
  for (const name of values) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  const types = ['CharAttrs', 'ParaAttrs', 'TypeSpec', 'TypeRun', 'TextConfig', 'TypeLayout', 'TypeMeasure', 'TypeFont', 'HyphenationLimits', 'TypeChange', 'SfntFace', 'OutlineSource', 'TextOutlines'];
  for (const name of types) assert.ok(now.types.includes(name), `and the type ${name}`);
  const text = { id: 't', tool: 'text' as const, color: '#1f2328', width: 1, points: [{ x: 20, y: 40 }], text: 'Acme Corp\nannual report', fontSize: 24 };
  const layout = api.layoutType(text);
  assert.deepEqual([layout.lines.length, layout.glyphs.length, layout.overset], [2, 22, false]);
  assert.equal(api.hyphenate('composition').join('-'), 'com-po-si-tion');
  const bytes = new Uint8Array(readFileSync(join(ROOT, 'test', 'fonts', 'napkin-test-sans.ttf')));
  const face = api.openSfnt(bytes);
  if (api.isSfntProblem(face)) throw new Error(face.problem);
  assert.equal(face.format, 'truetype');
  const source = api.fileOutlineSource({ 'Acme Sans': bytes }, api.HEADLESS_MEASURE);
  const word = { ...text, text: 'AVTo', fontFamily: 'Acme Sans' };
  assert.deepEqual(api.outlineText(word, api.layoutType(word, source.measure), source).marks?.map((made) => made.label), ['A', 'V', 'T', 'o'], 'a mark a glyph');
});

test("the barrel exports Text Configurations: a book's named character attributes, applied, resolved, merged and dropped", () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'DEFAULT_CONFIG_NAME', 'NEW_CONFIG_NAME', 'adoptTextConfigs', 'applyTextConfig', 'breakTextConfigLink', 'canonicalConfig', 'captureConfigAttrs', 'clearTextOverrides',
    'configInUse', 'configsOf', 'detachTextConfig', 'dropUnusedTextConfigs', 'duplicateTextConfig', 'followedConfigIds', 'followsConfig', 'mergeTextConfigs', 'newTextConfig',
    'nextConfigName', 'overridesOf', 'readConfigTargets', 'replaceTextConfig', 'resolveRunAttrs', 'revertTextConfig', 'sameConfigAttrs', 'syncBookConfigs', 'uniqueConfigName',
    'unusedTextConfigs', 'withConfigDefinitions',
  ];
  for (const name of values) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  for (const name of ['ConfigMerge', 'ConfigReading']) assert.ok(now.types.includes(name), `and the type ${name}`);
  const heading = api.newTextConfig([], { fontSize: 40, fontStyle: 'Bold' }, 'tc_heading', 'Heading');
  const text = { id: 't', tool: 'text' as const, color: '#1f2328', width: 1, points: [{ x: 20, y: 60 }], text: 'Acme Corp', fontSize: 24 };
  const styled = api.applyTextConfig(text, { start: 0, end: 4 }, heading);
  assert.equal(api.styleSegments(styled).map((segment) => `${segment.end}:${segment.attrs.fontSize}`).join(' '), '4:40 9:24');
  assert.equal(api.resolveRunAttrs(api.baseAttrs(text), heading, { color: '#c0392b' }).fontStyle, 'Bold', 'its base, then the configuration, then the overrides');
  assert.deepEqual([...api.configsOf(styled).keys()], ['tc_heading'], 'the text carries a copy of what it follows, by id');
});

test('the barrel exports Markdown Flow, and napkin-sketch/markdown registers its reader with it', async () => {
  const now = exportsOf('src/api/index.ts');
  for (const name of ['MARKDOWN_CONFIG_NAMES', 'MARKDOWN_THEME', 'markdownConfig', 'markdownEnter', 'markdownLexer', 'markdownMissing', 'markdownShown', 'markdownToType', 'setMarkdownLexer', 'typeShown', 'withMarkdownConfigs', 'withoutMarkdownReveal']) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['MarkdownBlock', 'MarkdownCell', 'MarkdownConfigKey', 'MarkdownLexer', 'MarkdownMissing', 'MarkdownOptions', 'MarkdownShown', 'MarkdownTheme', 'MarkdownToken', 'MarkdownType']) {
    assert.ok(now.types.includes(name), `and the type ${name}`);
  }
  api.setMarkdownLexer(null);
  assert.equal(api.markdownToType('**x**').text, '**x**', 'with no lexer the core shows the Markdown as it is');
  const markdown = await import('../src/markdown/index.js');
  assert.equal(api.markdownLexer(), markdown.markedLexer, 'importing the subpath registers its lexer with the barrel');
  assert.equal(api.markdownToType('**x**').text, 'x');
  assert.equal(markdown.markdownToType('# Notes\n\n- one\n- **two**').text, 'Notes\none\ntwo', 'the example its comment gives');
  assert.equal(typeof (node as Record<string, unknown>).drawFile, 'function', 'and napkin-sketch/node reads with it too');
  const { readers } = await import('../src/markdown/core.js');
  assert.equal(markdown.markedLexer, readers.markedLexer, 'one set of readers: the entry registers the ones every entry shares');
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(build, /\{ in: resolve\(root, 'src\/markdown\/index\.ts'\), out: 'markdown\/index' \}/, 'the build writes the entry');
  assert.match(build, /splitting: true/, 'beside the others, sharing their core');
  assert.match(build, /'dist\/markdown'/, 'and scopes its folder to ESM');
});

test('the barrel exports Clean Language Accents, and napkin-sketch/markdown gives it highlight.js and the way to install a language', async () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'ACCENT_LANGUAGES', 'ACCENT_SCOPES', 'ACCENT_THEMES', 'COMMON_ACCENT_LANGUAGES', 'accentGeneration', 'accentHighlighter', 'accentLanguage', 'accentOptions', 'accentRuns',
    'accentShown', 'accentThemeFor', 'applyAccent', 'contrastRatio', 'currentAccentTheme', 'hasAccent', 'hljsHtmlToRuns', 'paragraphSpan', 'relativeLuminance',
    'setAccentHighlighter', 'setAccentOptions', 'setAccentPage', 'withAccentPage',
  ];
  for (const name of values) {
    assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  }
  for (const name of ['AccentHighlighter', 'AccentLanguage', 'AccentResult', 'AccentRole', 'AccentRun', 'AccentTheme', 'AccentThemeId']) assert.ok(now.types.includes(name), `and the type ${name}`);
  assert.equal(api.ACCENT_LANGUAGES.length, 193);
  assert.equal(api.ACCENT_THEMES.dark.name, 'Napkin Dark');
  const markdown = await import('../src/markdown/index.js');
  assert.equal(api.accentHighlighter(), markdown.hljsHighlighter, 'importing the subpath registers highlight.js with the barrel');
  assert.equal(api.accentRuns('x = 1', 'python').language, 'python');
  for (const name of ['registerAccentLanguage', 'unregisterAccentLanguage', 'accentLanguagesInstalled']) assert.equal(typeof (markdown as Record<string, unknown>)[name], 'function', `the subpath exports ${name}`);
  assert.equal(markdown.accentLanguagesInstalled().length, 36);
});

test('the barrel exports Composition Styles, which restyle a page and a composition alike', () => {
  const now = exportsOf('src/api/index.ts');
  const values = [
    'COMPOSITION_RULE_FIELDS', 'COMPOSITION_RULE_KEYS', 'COMPOSITION_RULE_KINDS', 'COMPOSITION_RULE_LABELS', 'COMPOSITION_STYLE_FORMAT', 'COMPOSITION_STYLE_NAME_MAX',
    'COMPOSITION_STYLE_SCHEMA_ID', 'applyCompositionStyle', 'applyCompositionStyleToBook', 'captureCompositionStyle', 'captureLayerRule', 'compositionReportLines',
    'compositionReportTitle', 'compositionRuleSummary', 'compositionStyleFileName', 'compositionStyleRuleCount', 'compositionStyleSchema', 'isDefaultLayerName',
    'layerNameKey', 'nameDistance', 'nameSuggestions', 'renameLayers', 'serializeCompositionStyle', 'uniqueStyleName', 'validateCompositionStyle',
  ];
  for (const name of values) assert.ok(now.values.includes(name), `the barrel exports ${name}`);
  const types = ['CompositionFieldKind', 'CompositionStyle', 'CompositionLayerRule', 'CompositionTextRule', 'CompositionStrokeRule', 'CompositionStyleReport', 'CompositionStyleValidation', 'SketchStyleResult'];
  for (const name of types) {
    assert.ok(now.types.includes(name), `and the type ${name}`);
  }
  const style = { napkinCompositionStyle: 1, name: 'Midnight', layers: { Background: { opacity: 0.5 } } };
  assert.equal(api.validateCompositionStyle(style).ok, true);
  const composition = api.createComposition();
  composition.rect({ name: 'background', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' });
  const { composition: styled, report } = api.applyCompositionStyle(composition, style);
  assert.equal(styled.elements[0].opacity, 0.5, 'a composition, by its elements\' names');
  assert.equal(api.compositionReportTitle(report), 'Applied Midnight');
  assert.deepEqual(api.nameSuggestions('Titel', ['Title']), ['Title']);
  assert.equal(api.nameDistance('Titel', 'Title'), 1, 'two letters swapped are one slip');
  assert.equal(api.layerNameKey('  Title '), api.layerNameKey('title'), 'a name matches trimmed and in any case');
});

test('napkin-sketch/node exports the host, and every composition file helper beside it', async () => {
  const host = ['drawFile', 'drawToFiles', 'readScript', 'loadAssets', 'loadDocuments', 'loadFonts', 'readCompositionStyle', 'writeBook', 'resolveLinkFromDir'];
  for (const name of host) assert.equal(typeof (node as Record<string, unknown>)[name], 'function', `${name} is exported`);
  for (const name of Object.keys(designFiles)) {
    assert.equal((node as Record<string, unknown>)[name], (designFiles as Record<string, unknown>)[name], `${name} is re-exported as it is`);
  }
  const types = exportsOf('src/api/node.ts').types;
  for (const name of ['DrawResult', 'DrawToFilesOptions', 'FontSources', 'WriteBookOptions', 'WrittenFile']) {
    assert.ok(types.includes(name), `napkin-sketch/node exports the type ${name}`);
  }
  // A composition style read from a file, checked as the panel and the command line check it.
  const dir = mkdtempSync(join(tmpdir(), 'napkin-style-'));
  try {
    const file = join(dir, 'midnight.json');
    writeFileSync(file, JSON.stringify({ napkinCompositionStyle: 1, name: 'Midnight', layers: { Background: { opacity: 0.5 } } }));
    assert.equal((await node.readCompositionStyle(file)).name, 'Midnight');
    writeFileSync(file, '{');
    await assert.rejects(node.readCompositionStyle(file), /is not JSON/);
    writeFileSync(file, JSON.stringify({ name: 'Midnight' }));
    await assert.rejects(node.readCompositionStyle(file), /is not a composition style/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  assert.deepEqual(pkg.exports['./markdown'], { types: './dist/markdown/index.d.ts', import: './dist/markdown/index.js', default: './dist/markdown/index.js' });
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './graphic-design/files', './markdown', './node', './styles.css'], 'and no entry this test does not know');
  assert.ok(pkg.files.includes('docs/api'), 'the documentation ships with the package');
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(build, /\{ in: resolve\(root, 'src\/api\/node\.ts'\), out: 'node\/index' \}/, 'the build writes the node entry');
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
