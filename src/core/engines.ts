/**
 * The `/engines` entry: the engines the app's tools stand on, and the page
 * model they edit.
 *
 * Regions combined and cut, the Eraser, the Wipe Stacks and the Shape Stacker,
 * Split, clipping masks, the Pencil's grades and grain, the Smear and Liquify,
 * with the calls that build a page and read and write a book, so a program
 * that edits pages needs nothing else. The blend modes, the effects, 3D and
 * type stay on the main entry, which shares them with the language. The names
 * are the main entry's own, the same functions.
 *
 * The main entry names these from the modules that define them and not through
 * this file: a module of re-exports that two entries share is written as a
 * chunk of its own, empty, which every page would fetch.
 */

// The page model.
export {
  DEFAULT_BACKGROUND,
  DEFAULT_FONT_FAMILY,
  DEFAULT_SURFACE,
  SKETCHBOOK_EXTENSION,
  SKETCHBOOK_VERSION,
  createId,
  createLayer,
  createSketch,
  createSketchBook,
  isImageStroke,
  isTextStroke,
  layerOf,
  strokesOnLayer,
  widthAtPressure,
  type Layer,
  type Point,
  type Sketch,
  type SketchBook,
  type Smudge,
  type Stroke,
  type Tool,
} from './types.js';
export {
  deriveName,
  normalizeSketchBook,
  parseSketchBook,
  serializeSketchBook,
  withSketchBookExtension,
  type NormalizeOptions,
} from './serialize.js';

// Regions combined and cut.
export {
  BOOLEAN_EDGE_LIMIT,
  booleanOp,
  booleanRegions,
  type BooleanOp,
  type BooleanOptions,
  type BooleanResult,
  type FillRule,
} from './boolean.js';

// The Eraser.
export { eraseKind, eraseMarks, eraseRegionOf, type EraseKind, type EraseRegion, type EraseResult } from './erase.js';

// The Wipe Stacks and the Shape Stacker.
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
} from './wipe.js';

// Split.
export {
  SPLIT_REACH_PX,
  isSplittable,
  nearestOnMark,
  splitMark,
  splitTarget,
  type SplitPieces,
  type SplitPoint,
} from './split.js';

// Clipping masks.
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
} from './clip.js';

// The Pencil's grades and grain.
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
} from './pencil.js';

// The Smear.
export {
  DEFAULT_SMEAR_STRENGTH,
  mapSmudges,
  smearReaches,
  smudgeBuffer,
  smudgeFor,
  type SmudgePass,
  type SmudgeState,
} from './smudge.js';

// Liquify.
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
} from './liquify.js';
