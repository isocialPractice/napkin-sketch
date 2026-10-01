/**
 * Public, framework-agnostic API for napkin-sketch.
 *
 * Import this from a website, a WordPress block, or a VS Code webview to embed
 * the editor or reuse the auto-sharpen engine without Electron:
 *
 * ```ts
 * import { NapkinSketch, sharpenStrokes } from 'napkin-sketch';
 * ```
 *
 * Or draw from written instructions, in a browser or in plain Node:
 *
 * ```ts
 * import { evaluate, renderSketch } from 'napkin-sketch';
 * const { ok, book, diagnostics } = evaluate('napkin 1\npage 400 300\ncircle 200 150 60');
 * const svg = renderSketch(book.sketches[0], { format: 'svg' });
 * ```
 *
 * Everything exported here is browser-safe (no Node or Electron imports).
 * Reading and writing files is in `napkin-sketch/node`.
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

// Effects: the CSS filter functions as data, on a mark, a layer or an
// element, drawn by every output that can draw them.
export { EFFECT_TYPES, cssFilter, readEffects, type Effect, type EffectType } from '../core/effects.js';

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

// Napkin script: a drawing from written instructions, with no DOM. The
// language reads no file; `napkin-sketch/node` is the host that does.
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

// Graphic-design API (browser-safe; Node file helpers live in
// `core/graphic-design/files`, the canvas painter in `.../canvas`)
export {
  Composition,
  ElementList,
  createComposition,
  renderComposition,
  renderPng,
  compositionToSvg,
  rasterizeComposition,
  decodePng,
  encodePng,
  layoutText,
  measureText,
  DEFAULT_COMPOSITION_SIZE,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_FONT,
  type CompositionDocument,
  type CompositionFormat,
  type Element as DesignElement,
  type PageOptions,
  type ParagraphStyle,
  type RasterOptions,
  type RasterResult,
  type RenderOptions,
  type SvgOptions,
  type TextStyle,
} from '../core/graphic-design/index.js';

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
