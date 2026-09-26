/**
 * Napkin script: instructions in, a drawing out.
 *
 * The language's front end. `parseScript` reads text, `validateScript` checks
 * a script built as JSON, and both return the same instruction list with the
 * same diagnostics; `formatScript` writes a script back as text. Everything
 * here is browser-safe and DOM-free.
 */

export * from './instructions.js';
export { parseScript, type ParseOptions, type ParseResult } from './parse.js';
export { validateScript } from './validate.js';
export { formatScript, type FormatOptions } from './format.js';
export {
  evaluate,
  runScript,
  type Box,
  type CropHint,
  type EvaluateOptions,
  type OutputHints,
  type RunResult,
  type ScriptResult,
  type ScriptSource,
  type ScriptStats,
} from './evaluate.js';
export { drawSvg, type DrawSvgOptions, type DrawSvgResult } from './draw.js';
export { SketchSink, type LayerProps, type PageSpec, type ScriptSink, type SinkCursor, type SketchSinkOptions } from './sink.js';
export {
  RENDER_FORMATS,
  inkBox,
  renderBook,
  renderBox,
  renderSketch,
  type RenderCrop,
  type RenderFormat,
  type RenderSketchOptions,
} from './render.js';
export { sketchToComposition, type SketchCompositionOptions } from '../sketch-composition.js';
export type { LinkResolver } from '../link.js';
export {
  SHAPE_LIBRARY,
  SHAPE_NAMES,
  findShape,
  fitShape,
  shapeBox,
  type FittedPart,
  type LibraryAnchor,
  type LibraryPart,
  type LibraryPoint,
  type LibraryShape,
  type ShapeLibrary,
} from './library.js';
export { DEFAULT_INK, DEFAULT_TEXT_SIZE, DEFAULT_WIDTH, defaultPaint, type Frame, type PaintState, type RoughState } from './state.js';
export {
  EXPRESSION_FUNCTIONS,
  ExpressionError,
  PAGE_NAMES,
  evaluateExpression,
  parseExpression,
  type BinaryOperator,
  type ExprFunction,
  type ExprNode,
  type ExprParse,
  type ExprScope,
} from './expr.js';
export { formatDiagnostic, hasErrors, makeDiagnostic, sortDiagnostics, type Where } from './diagnostics.js';
export { tokenize, type Token, type TokenKind, type TokenizeResult } from './tokenize.js';
export {
  IDENTIFIER,
  RESERVED_NAMES,
  formatNumber,
  isColor,
  isExpr,
  isIdentifier,
  isKnownUnit,
  quoteString,
  readLengthLiteral,
  type LengthLiteral,
} from './values.js';
export {
  DEFAULT_SCRIPT_HELPER_COMMAND,
  SCRIPT_FORM_FILE,
  SCRIPT_HELPER_ATTEMPTS,
  SCRIPT_OUT_FILE,
  SCRIPT_SKILL_NAME,
  promptScript,
  scriptForm,
  scriptFromReply,
  scriptFromSaved,
  type PromptFailure,
  type PromptScriptOptions,
  type PromptScriptResult,
  type ScriptFormOptions,
  type ScriptHelperRun,
  type ScriptHelperRunner,
} from './ai-bridge.js';
