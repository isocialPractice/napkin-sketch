/**
 * Public, framework-agnostic API for napkin-sketch.
 *
 * Import this from a website, a WordPress block, or a VS Code webview to embed
 * the editor or reuse the auto-sharpen engine without Electron:
 *
 * ```ts
 * import { NapkinSketch, sharpenStrokes } from '@isocialpractice/napkin-sketch';
 * ```
 *
 * Or draw from written instructions, in a browser or in plain Node:
 *
 * ```ts
 * import { evaluate, renderSketch } from '@isocialpractice/napkin-sketch';
 * const { ok, book, diagnostics } = evaluate('napkin 1\npage 400 300\ncircle 200 150 60');
 * const svg = renderSketch(book.sketches[0], { format: 'svg' });
 * ```
 *
 * Everything exported here is browser-safe (no Node or Electron imports).
 * Reading and writing files is in `@isocialpractice/napkin-sketch/node`.
 */

export { NapkinSketch } from './embed.js';
export type { NapkinOptions } from './embed.js';

// Data model
export {
  SKETCHBOOK_VERSION,
  SKETCHBOOK_EXTENSION,
  DEFAULT_SURFACE,
  DEFAULT_BACKGROUND,
  DEFAULT_FONT_FAMILY,
  createId,
  createLayer,
  createSketch,
  createSketchBook,
  isImageStroke,
  isTextStroke,
  layerOf,
  strokesOnLayer,
  type Layer,
  type Point,
  type Stroke,
  type Sketch,
  type SketchBook,
  type Smudge,
  type Tool,
  widthAtPressure,
} from '../core/types.js';

// Serialization (browser-safe)
export {
  withSketchBookExtension,
  deriveName,
  normalizeSketchBook,
  parseSketchBook,
  serializeSketchBook,
  type NormalizeOptions,
} from '../core/serialize.js';

// Auto-sharpen engine
export {
  DEFAULT_SHARPEN_OPTIONS,
  sharpenPoints,
  sharpenStroke,
  sharpenStrokes,
  classify,
  type SharpenOptions,
  type ShapeKind,
} from '../sharpen/sharpen.js';

// Vector export (browser-safe; PDF import lives in Node-only `pdf-import`)
export { sketchesToPdf } from '../core/pdf.js';

// An Illustrator script that rebuilds a drawing natively, links as placed items
export { sketchesToJsx, type JsxOptions } from '../core/illustrator.js';

// Effects: the CSS filter functions and the appearance effects - Feather,
// Bevel, Emboss, Outer and Inner Shadow, Outer and Inner Glow - as data on a
// mark, a layer or an element, each aimable at a mark's fill or stroke; the
// pixel passes the canvas and the PNG draw them with, the graph the SVG
// writes; and the appearance stack the Appearance panel edits, a list of
// effects changed by pure edits that never touch the list given.
export {
  CSS_EFFECT_TYPES,
  EFFECT_DEFAULTS,
  EFFECT_LABELS,
  EFFECT_TYPES,
  GEOMETRY_EFFECT_TYPES,
  MARK_ONLY_EFFECT_TYPES,
  activeEffects,
  activeGeometryEffects,
  cssFilter,
  defaultEffect,
  effectLayout,
  effectPaintReach,
  effectPlan,
  effectReach,
  isCssEffect,
  readEffect,
  readEffects,
  scaleEffects,
  type AppearanceEffectInput,
  type AppearanceEffectType,
  type Effect,
  type EffectInput,
  type EffectOf,
  type EffectPlan,
  type EffectShade,
  type EffectTarget,
  type EffectType,
  type MarkParts,
  type ReliefEffect,
  type ThreeDLight,
  type ThreeDShading,
} from '../core/effects.js';
export {
  blankImage,
  blurPixels,
  fromRgba8,
  inkBox as imageInkBox,
  layOnto,
  runEffects,
  toRgba8,
  type FxBox,
  type FxImage,
  type FxUnder,
  type FxWarn,
} from '../core/appearance-fx.js';
export {
  BLEND_FIELD_CHOICES,
  EFFECT_FIELDS,
  EFFECT_ORIGINS,
  addEffect,
  aimedAt,
  appearanceSections,
  duplicateEffect,
  effectFieldValue,
  effectName,
  effectsAfterTransform,
  expandAppearance,
  geometryShape,
  hasGeometryEffects,
  inDrawingOrder,
  isGeometryEffect,
  markParts,
  moveEffect,
  partOnly,
  registerGeometryEffect,
  removeEffect,
  replaceEffect,
  retargetEffect,
  sameEffects,
  splitsParts,
  targetOf,
  toggleEffect,
  withEffectField,
  type AppearanceTarget,
  type EffectField,
  type EffectFieldKind,
  type EffectTransform,
  type ExpandedAppearance,
  type GeometryEffectKind,
  type StackEntry,
} from '../core/appearance.js';

// Splatter, Warp and 3D: the effects that change what a mark draws before any
// picture is made of it - its fill as a loose hatch, the mark bent by a
// style, the mark built in depth and drawn as shaded faces - and the binding
// that lets a layer's Warp reach the marks under it.
export {
  SPLATTER_MAX_PASSES,
  SPLATTER_PRESETS,
  SPLATTER_PRESET_LABELS,
  SPLATTER_PRESET_NAMES,
  matchingPreset,
  splatterAnchors,
  splatterPaths,
  splatterPresetOf,
  type SplatterOptions,
  type SplatterPresetName,
  type SplatterValues,
} from '../core/splatter.js';
export {
  WARP_PARTS,
  WARP_STYLES,
  WARP_STYLE_LABELS,
  WARP_STYLE_ORIGINS,
  warpPartFor,
  warpPartsOf,
  warpStyleMap,
  warpStyleOf,
  type Jacobian,
  type WarpBox,
  type WarpMap,
  type WarpOptions,
  type WarpPart,
  type WarpStyle,
} from '../core/warp-styles.js';
export { bindGeometry, drawnMark, drawnMarks, drawnPart, geometryOf, geometryParts, type DrawnGeometry, type GeometryParts } from '../core/geometry-effects.js';
export {
  extrudeMesh,
  revolveMesh,
  revolveStepCount,
  triangulate,
  type Mesh as ThreeDMesh,
  type MeshFace,
  type Outline as ThreeDOutline,
  type RevolveShape,
  type Vec2,
  type Vec3,
} from '../core/three-d/mesh.js';
export {
  buildSolid,
  projectPoint,
  render3d,
  renderSolid,
  threeDView,
  viewOf,
  viewPoint,
  type Face as ThreeDFace,
  type Paint3d,
  type Solid,
  type ThreeDEffect,
  type ThreeDView,
} from '../core/three-d/render.js';
// The 3D gumball's own sums, DOM-free: where its arrows, squares, arcs and
// boxes are drawn for a view, which one a point is on, and what a drag does,
// for an embedder's own overlay.
export {
  cancelGumballDrag,
  dragGumball,
  eulerOf,
  gumballHit,
  gumballLayout,
  gumballMoved,
  startGumballDrag,
  trackballTurn,
  type GumballDrag,
  type GumballHandle,
  type GumballKeys,
  type GumballLayout,
  type GumballObject,
} from '../renderer/gumball.js';

// Napkin Blends: the sixteen blend modes of a vector editor's Transparency
// panel under napkin names - Stack Blend for Multiply, Sheer Blend for Screen -
// with what CSS, PDF and Illustrator's scripting call each, and the W3C
// compositing math that mixes a color with what is under it.
export {
  BLEND_MODES,
  BLEND_MODE_IDS,
  BLEND_MODE_NAMES,
  blendChannel,
  blendColor,
  blendModeInfo,
  blendModeOf,
  blendPixel,
  compositeOperation,
  isBlended,
  isSeparable,
  type BlendFamily,
  type BlendMode,
  type BlendModeId,
  type GlobalCompositeOperationName,
  type Rgb,
  type Rgba,
  type SeparableBlendModeId,
} from '../core/blend.js';

// Paint: which of a mark's two paints - its outline and its fill - a picked
// color goes to, and Swap Fill and Stroke: the rules of the drawing window's
// fill and stroke control, one mark at a time.
export { COLOR_TARGETS, paintPatch, swapPaint, type ColorTarget } from '../core/paint.js';

// Region geometry: the boolean engine the stroke profiles, the Eraser and the
// wipes stand on; erasing as geometry; the wipes - a vector editor's
// Pathfinder, six operations on marks - with the faces of an arrangement; and
// stacking - its Shape Builder - which merges faces or takes them away; and
// splitting - its Scissors - which cuts a path where a point lands on it; and
// clipping masks, a group that shows only inside the closed mark on top.
export {
  BOOLEAN_EDGE_LIMIT,
  booleanOp,
  booleanRegions,
  type BooleanOp,
  type BooleanOptions,
  type BooleanResult,
  type FillRule,
} from '../core/boolean.js';
export { eraseKind, eraseMarks, eraseRegionOf, type EraseKind, type EraseRegion, type EraseResult } from '../core/erase.js';
export {
  WIPE_FACE_LIMIT,
  WIPE_OPERAND_LIMIT,
  WIPE_OPS,
  arrangeFaces,
  faceAt,
  facesAlong,
  facesInBox,
  stackArrangement,
  stackEdit,
  stackFaces,
  wipeMarks,
  wipeOperand,
  type Arrangement,
  type Face,
  type MarkEdit,
  type StackArrangement,
  type StackBox,
  type StackMode,
  type StackResult,
  type WipeOp,
  type WipeOperand,
  type WipeProblem,
  type WipeResult,
} from '../core/wipe.js';
export { SPLIT_REACH_PX, isSplittable, nearestOnMark, splitMark, splitTarget, type SplitPieces, type SplitPoint } from '../core/split.js';
export {
  CLIP_GROUP_NAME,
  canClip,
  clipIndex,
  clipMarkOf,
  clipRegionOf,
  clippedAt,
  makeClip,
  normalizeClips,
  releaseClip,
  shownBounds,
  type Clip,
  type ClipIndex,
  type ClipProblem,
} from '../core/clip.js';
// The Pencil: the drawing kit's grades, how each lays down through the
// paper's tooth, and a mark's picture as the canvas paints it.
export {
  DEFAULT_PENCIL,
  GRAIN_TILE_SIZE,
  PENCIL_GRADES,
  PENCIL_KIT,
  grainTile,
  parsePencil,
  pencilCoverage,
  pencilGrade,
  pencilMeanCoverage,
  pencilPaint,
  pencilPicture,
  pencilRegion,
  pencilWidth,
  rasterizePencil,
  type PencilChoice,
  type PencilGrade,
  type PencilMedium,
  type PencilRegion,
} from '../core/pencil.js';
// The Smear: a blending stump's pass over a Pencil mark's picture, and the
// pass a drag leaves on each mark it reached.
export {
  DEFAULT_SMEAR_STRENGTH,
  mapSmudges,
  smearReaches,
  smudgeBuffer,
  smudgeFor,
  type SmudgePass,
  type SmudgeState,
} from '../core/smudge.js';
// Liquify: a vector editor's Warp tools - Warp, Twirl, Pucker and Bloat - as
// fields that bend the marks under a brush, and the refit after a drag.
export {
  LIQUIFY_MODES,
  liquifiable,
  liquifyFalloff,
  liquifyField,
  liquifyMarks,
  liquifyReaches,
  refitLiquified,
  type LiquifyDab,
  type LiquifyMode,
  type LiquifyOptions,
} from '../core/liquify.js';
export type { PointMap } from '../core/mesh-warp.js';

// Arc length: a path walked by distance rather than by its curves' own
// parameter - the point, the direction, the bend so far along - which text on
// a path, Splatter and Warp measure by.
export {
  cubicAt,
  cubicDerivative,
  curvatureAtLength,
  lengthTable,
  nearestLength,
  normalAtLength,
  pointAtLength,
  segmentTAtLength,
  tangentAtLength,
  type LengthTable,
  type Vec,
} from '../core/arc-length.js';

// Napkin script: a drawing from written instructions, with no DOM. The
// language reads no file; `@isocialpractice/napkin-sketch/node` is the host that does.
export {
  parseScript,
  validateScript,
  formatScript,
  formatDiagnostic,
  evaluate,
  drawSvg,
  renderSketch,
  renderBook,
  inkBox,
  renderBox,
  sketchToComposition,
  RENDER_FORMATS,
  SCRIPT_VERSION,
  SCRIPT_LIMITS,
  VERBS,
  DIAGNOSTICS,
  type Box,
  type CropHint,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSpec,
  type DrawSvgOptions,
  type DrawSvgResult,
  type EvaluateOptions,
  type Instruction,
  type LinkResolver,
  type OutputHints,
  type RenderCrop,
  type RenderFormat,
  type RenderSketchOptions,
  type ScriptLimits,
  type ScriptResult,
  type ScriptSource,
  type ScriptStats,
  type SketchCompositionOptions,
  type VerbSpec,
} from '../core/script/index.js';

// Type: a text's model - its runs of character attributes, its paragraphs,
// the copies of the Text Configurations it follows - and the edits that keep
// it whole; the layout that sets it as point, area or path type, horizontal
// or vertical; the hyphenation it breaks words by; the readers and changes of
// the Type panel and the Type menu's options; and the font reader and
// outliner that draw it as shapes.
export {
  CHAR_KEYS,
  CONFIG_KEYS,
  CONFIG_NAME_MAX,
  DEFAULT_CHAR,
  DEFAULT_PARA,
  PARA_KEYS,
  TYPE_LIMITS,
  applyChar,
  applyPara,
  baseAttrs,
  charAttrsAt,
  paraAttrsOf,
  paragraphAt,
  paragraphRanges,
  readCharAttrs,
  readParaAttrs,
  readTextConfig,
  readTextConfigs,
  readTypeset,
  recolorText,
  restyleText,
  sameConfigName,
  spliceText,
  styleSegments,
  typeSpecOf,
  withTypeset,
  type CharAttrs,
  type ParaAttrs,
  type PathAlign,
  type PathEffect,
  type StyleSegment,
  type TextConfig,
  type TextRange,
  type TypeFrame,
  type TypePath,
  type TypeRun,
  type TypeSpec,
} from '../core/type/model.js';
export { glyphCorners, layoutForEditing, layoutType, typeSpans, type TypeGlyph, type TypeLayout, type TypeSpan } from '../core/type/layout.js';
export { HEADLESS_MEASURE, type TypeFont, type TypeMeasure } from '../core/type/measure.js';
export {
  HYPHENATION_NOTICE,
  ILLUSTRATOR_LIMITS,
  TEX_LIMITS,
  hyphenatable,
  hyphenate,
  hyphenationPoints,
  type HyphenationLimits,
} from '../core/type/hyphenate.js';
export { applyTypeChange, readTargets, typingAttrsAt, type TypeChange, type TypeReading, type TypeTarget } from '../core/type/panel.js';
export { typeOnPath, typeablePath, type TypeablePath } from '../core/type/tool.js';
export {
  TYPE_OPTION_FIELDS,
  typeOptionValues,
  typeOptionsKindOf,
  withTypeOptions,
  type TypeOptionField,
  type TypeOptionValues,
  type TypeOptionsKind,
} from '../core/type/options.js';
export { glyphOutline, isSfntProblem, openSfnt, sfntFaceNames, type GlyphOutline, type SfntFace, type SfntProblem } from '../core/type/sfnt.js';
export {
  facesFromFiles,
  fileOutlineSource,
  outlineSource,
  outlineText,
  setOutlineSource,
  sfntMeasure,
  withOutlineSource,
  type FontFiles,
  type OutlineFaces,
  type OutlineSource,
  type OutlinedMark,
  type TextOutlines,
} from '../core/type/outline.js';

// Text Configurations: a book's named character attributes, which a text's
// runs follow by id - each text carrying a copy of what it follows - with
// overrides of their own; read, applied, redefined, merged and dropped.
export {
  DEFAULT_CONFIG_NAME,
  NEW_CONFIG_NAME,
  adoptTextConfigs,
  applyTextConfig,
  breakTextConfigLink,
  canonicalConfig,
  captureConfigAttrs,
  clearTextOverrides,
  configInUse,
  configsOf,
  detachTextConfig,
  dropUnusedTextConfigs,
  duplicateTextConfig,
  followedConfigIds,
  followsConfig,
  mergeTextConfigs,
  newTextConfig,
  nextConfigName,
  overridesOf,
  readConfigTargets,
  replaceTextConfig,
  resolveRunAttrs,
  revertTextConfig,
  sameConfigAttrs,
  syncBookConfigs,
  uniqueConfigName,
  unusedTextConfigs,
  withConfigDefinitions,
  type ConfigMerge,
  type ConfigReading,
} from '../core/type/configs.js';

// Markdown Flow: a text typed as Markdown and shown as it renders, read by the
// lexer it is given - `@isocialpractice/napkin-sketch/markdown` registers marked's - so the
// core holds no Markdown reader of its own.
export {
  MARKDOWN_CONFIG_NAMES,
  MARKDOWN_THEME,
  markdownConfig,
  markdownEnter,
  markdownLexer,
  markdownMissing,
  markdownShown,
  markdownToType,
  setMarkdownLexer,
  typeShown,
  withMarkdownConfigs,
  withoutMarkdownReveal,
  type MarkdownBlock,
  type MarkdownCell,
  type MarkdownConfigKey,
  type MarkdownLexer,
  type MarkdownMissing,
  type MarkdownOptions,
  type MarkdownShown,
  type MarkdownTheme,
  type MarkdownToken,
  type MarkdownType,
} from '../core/type/markdown-flow.js';

// Clean Language Accents: code colored as its language reads it, from the
// highlighter the core is given - `@isocialpractice/napkin-sketch/markdown` gives it
// highlight.js - in Napkin Light or Napkin Dark.
export {
  ACCENT_LANGUAGES,
  ACCENT_SCOPES,
  ACCENT_THEMES,
  COMMON_ACCENT_LANGUAGES,
  accentGeneration,
  accentHighlighter,
  accentLanguage,
  accentOptions,
  accentRuns,
  accentShown,
  accentThemeFor,
  applyAccent,
  contrastRatio,
  currentAccentTheme,
  hasAccent,
  hljsHtmlToRuns,
  paragraphSpan,
  relativeLuminance,
  setAccentHighlighter,
  setAccentOptions,
  setAccentPage,
  withAccentPage,
  type AccentHighlighter,
  type AccentLanguage,
  type AccentResult,
  type AccentRole,
  type AccentRun,
  type AccentTheme,
  type AccentThemeId,
} from '../core/type/accents.js';

// Composition Styles: rules keyed by layer name that restyle a page, or a
// composition by its elements' names, with a report of what did not match.
export {
  COMPOSITION_RULE_FIELDS,
  COMPOSITION_RULE_KEYS,
  COMPOSITION_RULE_KINDS,
  COMPOSITION_RULE_LABELS,
  COMPOSITION_STYLE_FORMAT,
  COMPOSITION_STYLE_NAME_MAX,
  COMPOSITION_STYLE_SCHEMA_ID,
  applyCompositionStyle,
  applyCompositionStyleToBook,
  captureCompositionStyle,
  captureLayerRule,
  compositionReportLines,
  compositionReportTitle,
  compositionRuleSummary,
  compositionStyleFileName,
  compositionStyleRuleCount,
  compositionStyleSchema,
  isDefaultLayerName,
  layerNameKey,
  nameDistance,
  nameSuggestions,
  renameLayers,
  serializeCompositionStyle,
  uniqueStyleName,
  validateCompositionStyle,
  type CompositionDocumentStyleResult,
  type CompositionFieldKind,
  type CompositionLayerChange,
  type CompositionLayerRule,
  type CompositionReportItem,
  type CompositionReportKind,
  type CompositionRuleField,
  type CompositionRuleKind,
  type CompositionStrokeRule,
  type CompositionStyle,
  type CompositionStyleNote,
  type CompositionStyleOptions,
  type CompositionStyleReport,
  type CompositionStyleValidation,
  type CompositionTextRule,
  type SketchStyleResult,
} from '../core/composition-style.js';

// Graphic-design API (browser-safe; Node file helpers live in
// `core/graphic-design/files`, the canvas painter in `.../canvas`). Named from
// the modules that define them rather than through `graphic-design/index`,
// the `/graphic-design` entry: a module of re-exports that two entries share
// is written as a chunk of its own, empty, and every page would fetch it.
export {
  Composition,
  ElementList,
  createComposition,
  renderComposition,
  renderPng,
  type CompositionFormat,
  type RenderOptions,
} from '../core/graphic-design/compose.js';
export { compositionToSvg, type SvgOptions } from '../core/graphic-design/svg.js';
export { rasterizeComposition, type RasterOptions, type RasterResult } from '../core/graphic-design/raster.js';
export { decodePng, encodePng } from '../core/graphic-design/png.js';
export { layoutText, measureText } from '../core/graphic-design/font.js';
export type { Matrix } from '../core/graphic-design/geometry.js';
export {
  DEFAULT_COMPOSITION_SIZE,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_FONT,
  type CompositionDocument,
  type Element as DesignElement,
  type PageOptions,
  type ParagraphStyle,
  type TextStyle,
} from '../core/graphic-design/types.js';

// Brand resources: `resources.md`, vector inlining, and brand slots that fall
// back to the design language when no asset is configured.
export {
  brandMark,
  brandRegion,
  descriptorFromFilename,
  detectBrandSlots,
  findBrandSlots,
  scanBrandBands,
  fitInto,
  inlineSvg,
  normalizeResourceKey,
  parseResources,
  placeBrand,
  type BrandBox,
  type BrandBand,
  type BrandDetection,
  type BrandScan,
  type BrandSlot,
  type PixelSource,
  type BrandMarkOptions,
  type BrandPalette,
  type BrandRegion,
  type BrandSource,
  type InlinedVector,
  type ParsedResources,
  type PlaceBrandOptions,
  type PlacedBrand,
  type ResourceEntry,
} from '../core/graphic-design/brand.js';

// Vector import (browser-only: relies on DOM SVG geometry APIs)
export { importSvg } from '../renderer/svg-import.js';
export type { ImportedLayer, ImportedSvg, SvgImportOptions } from '../renderer/svg-import.js';

// Rendering surface (advanced use)
export { Surface, strokeBounds } from '../renderer/surface.js';
export type { LiveStroke, Overlay } from '../renderer/surface.js';
